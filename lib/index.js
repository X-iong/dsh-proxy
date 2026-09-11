import Schema from '@deepseek-ai/schemastery';
import { connect } from 'node:net';
import { Agent, Dispatcher, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher, } from 'undici';
export const name = 'dsh-proxy';
export const inject = {};
/** Settings namespace this plugin owns; the browser card pairs with it. */
export const NS = 'dsh-proxy';
export const Config = Schema.object({
    enabled: Schema.boolean()
        .default(true)
        .description('启用自定义代理。关闭后恢复 DSH 宿主进程原来的网络方式。'),
    host: Schema.string()
        .default('127.0.0.1')
        .description('代理服务器地址，例如 127.0.0.1（Clash/mihomo 本机混合端口）。'),
    port: Schema.natural()
        .max(65535)
        .default(7890)
        .description('代理服务器端口，例如 7890（Clash/mihomo 混合端口）。'),
    noProxy: Schema.array(String)
        .default(['localhost', '127.0.0.1', '::1', '[::1]'])
        .description('绕过代理的主机名单：精确匹配主机名，或以 . 开头匹配域名后缀（如 .lan）。'),
    autoReset: Schema.boolean()
        .default(true)
        .description('自动重建连接池：检测到上游断开或请求发生传输层错误时，销毁并重建连接池，避免复用失效连接。'),
    probeUrl: Schema.string()
        .default('https://api.deepseek.com/models')
        .description('上游连通性探测地址：插件会定期用这个地址发起真实请求（穿过代理）来判断代理上游隧道是否可用。'),
});
const DEFAULT_NO_PROXY = ['localhost', '127.0.0.1', '::1', '[::1]'];
const DEFAULT_PROBE_URL = 'https://api.deepseek.com/models';
/** How often to re-check whether the proxy port is listening. */
const PROBE_INTERVAL_MS = 10000;
/** TCP connect timeout for one liveness probe. */
const PROBE_TIMEOUT_MS = 2000;
/** Upstream fetch timeout: how long a probe request may take before we treat the tunnel as broken. */
const UPSTREAM_TIMEOUT_MS = 8000;
/** Graceful periodic pool reset interval. */
const RESET_INTERVAL_MS = 60000;
/** Run the upstream probe every N-th liveness cycle (N * PROBE_INTERVAL_MS). */
const UPSTREAM_PROBE_EVERY = 3;
/** Debounce window for reactive rebuilds so a burst of failures triggers one rebuild. */
const REBUILD_DEBOUNCE_MS = 60;
/** Ceiling for the exponential rebuild backoff, so a sustained burst cannot rebuild on every failure. */
const REBUILD_BACKOFF_MAX_MS = 5000;
/** Consecutive upstream-probe failures after which the tunnel counts as unhealthy. */
const UPSTREAM_FAIL_THRESHOLD = 1;
function normalizeHostname(rawHost) {
    const host = rawHost.trim().toLowerCase();
    // Strip IPv6 brackets so "[::1]" and "::1" compare equal.
    return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}
export function shouldBypass(rawHost, noProxy) {
    const host = normalizeHostname(rawHost);
    if (!host)
        return false;
    for (const rawEntry of noProxy) {
        const entry = rawEntry.trim().toLowerCase();
        if (!entry)
            continue;
        if (entry === '*')
            return true;
        if (entry.startsWith('.')) {
            // Suffix match: ".lan" covers "nas.lan" but not "lan" itself.
            if (host.endsWith(entry))
                return true;
            continue;
        }
        if (host === normalizeHostname(entry))
            return true;
    }
    return false;
}
/** Compose the http proxy URL from the configured host and port. */
export function proxyUrlOf(config) {
    const host = (config.host ?? '127.0.0.1').trim();
    const port = config.port ?? 7890;
    if (!host)
        throw new Error('dsh-proxy: host is empty');
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`dsh-proxy: port ${JSON.stringify(port)} is not a valid TCP port`);
    }
    // Bracket IPv6 literals so the URL parses correctly.
    const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    return `http://${authority}:${port}`;
}
/** Host as `net.connect` expects it: IPv6 brackets stripped. */
function connectHost(config) {
    const host = (config.host ?? '127.0.0.1').trim();
    return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}
/**
 * Liveness probe: can we open a TCP connection to the proxy's host:port?
 * True means the proxy port is listening (the proxy process is up); false
 * means it is not (e.g. Clash/mihomo not started), so DSH should go direct.
 */
function probeProxy(host, port, timeoutMs) {
    return new Promise((resolve) => {
        let settled = false;
        let timer;
        const socket = connect({ host, port });
        const done = (ok) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            socket.destroy();
            resolve(ok);
        };
        timer = setTimeout(() => done(false), timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
    });
}
/** True when the error means the transport/connection itself failed (as opposed to a clean HTTP response). */
function isTransportError(error) {
    if (!error)
        return false;
    const direct = error?.code;
    const cause = error?.cause?.code;
    if (typeof direct === 'string' && /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_CLOSED|UND_ERR_DESTROYED)$/.test(direct))
        return true;
    if (typeof cause === 'string' && /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_CLOSED|UND_ERR_DESTROYED)$/.test(cause))
        return true;
    const message = String(error?.message ?? error?.cause?.message ?? '');
    return /ECONNRESET|ECONNREFUSED|socket hang up|other side closed|fetch failed|connect ETIMEDOUT/i.test(message);
}
/**
 * Copy a DispatchHandler and intercept onError to report transport failures.
 * Uses prototype delegation so every other handler method forwards untouched.
 */
function wrapHandler(handler, onTransportError) {
    if (!handler || typeof handler !== 'object')
        return handler;
    if (typeof handler.onError !== 'function')
        return handler;
    const wrapped = Object.create(handler);
    const original = handler.onError;
    wrapped.onError = function (error) {
        try {
            if (isTransportError(error))
                onTransportError(error);
        }
        catch {
            /* never let the hook break dispatch */
        }
        return original.call(handler, error);
    };
    return wrapped;
}
/**
 * Dispatcher that sends bypass-listed hosts straight out and everything else
 * through the proxy. Both agents use Node's default TLS negotiation (no forced
 * version). The two agents are created lazily and owned by this instance's
 * close()/destroy().
 */
class RoutedDispatcher extends Dispatcher {
    noProxy;
    direct;
    proxied;
    useProxy;
    onTransportError;
    constructor(proxyUrl, noProxy, useProxy, onTransportError) {
        super();
        this.noProxy = noProxy;
        this.useProxy = useProxy;
        this.onTransportError = onTransportError;
        this.direct = new Agent();
        this.proxied = new ProxyAgent({ uri: proxyUrl });
    }
    dispatch(opts, handler) {
        const wrapped = wrapHandler(handler, this.onTransportError);
        const origin = typeof opts.origin === 'string' ? opts.origin : opts.origin?.toString();
        let host = '';
        try {
            host = origin ? new URL(origin).hostname : '';
        }
        catch {
            host = '';
        }
        if (!this.useProxy || (host && shouldBypass(host, this.noProxy))) {
            return this.direct.dispatch(opts, wrapped);
        }
        return this.proxied.dispatch(opts, wrapped);
    }
    async close() {
        await Promise.allSettled([this.direct.close(), this.proxied.close()]);
    }
    async destroy() {
        await Promise.allSettled([this.direct.destroy(), this.proxied.destroy()]);
    }
    [Symbol.asyncDispose]() {
        return this.close();
    }
}
export function apply(ctx, config) {
    const logger = ctx.logger(name);
    // Snapshot the dispatcher that was global when the plugin loaded. Restoring
    // it on dispose keeps unload symmetric even if other code chained its own
    // dispatcher on top of ours in between.
    const previous = getGlobalDispatcher();
    let installed;
    let current = () => config;
    /** Whether the configured proxy port is currently reachable. */
    let alive = false;
    /**
     * Whether the upstream tunnel is believed healthy. Optimistic: a reachable
     * port is not proof that traffic flows, so the tunnel is tried and only
     * demoted after UPSTREAM_FAIL_THRESHOLD consecutive probe failures.
     */
    let upstreamHealthy = true;
    /** Consecutive upstream-probe failures; any successful probe resets it. */
    let upstreamFailures = 0;
    /** Routing mode of the installed dispatcher (undefined while none is installed). */
    let mode;
    /** Backoff window currently enforced between reactive rebuilds. */
    let rebuildBackoffMs = REBUILD_DEBOUNCE_MS;
    /** When the last rebuild happened, measured against rebuildBackoffMs. */
    let lastRebuildAt = 0;
    let probing = false;
    let disposed = false;
    let timer;
    let resetTimer;
    let resetPending = false;
    let probeCounter = 0;
    const isAutoReset = () => current().autoReset !== false;
    /**
     * The routing decision, in one place: the proxy is used only while the port is
     * reachable AND the tunnel is healthy. A reachable port with an unhealthy
     * tunnel degrades to direct, and the upstream probe keeps running, which is
     * what lets the proxy come back on its own.
     */
    const shouldUseProxy = () => alive && upstreamHealthy;
    /**
     * Record the routing mode and emit exactly one structurally stable line per
     * real switch, e.g. `dsh-proxy: mode proxy→direct reason=upstream-unreachable failures=2`.
     */
    const setMode = (useProxy, reason) => {
        const next = useProxy ? 'proxy' : 'direct';
        if (mode === next)
            return;
        logger.info(`dsh-proxy: mode ${mode ?? 'none'}→${next} reason=${reason}`);
        mode = next;
    };
    const uninstall = (reason) => {
        if (installed === undefined)
            return;
        const active = installed;
        installed = undefined;
        mode = undefined;
        setGlobalDispatcher(previous);
        active.close().catch((error) => logger.warn('closing dispatcher failed:', error));
        logger.info(`custom proxy disabled (${reason}); restored the previous global dispatcher`);
    };
    const buildDispatcher = (rawConfig, useProxy) => {
        const proxyUrl = proxyUrlOf(rawConfig);
        const noProxy = rawConfig.noProxy ?? DEFAULT_NO_PROXY;
        return new RoutedDispatcher(proxyUrl, noProxy, useProxy, onTransportError);
    };
    const install = (rawConfig, useProxy, reason) => {
        // A probe that was already in flight when the plugin unloaded can still
        // resolve here. Installing then would re-publish a dispatcher and log a
        // transition *after* disposal, so the global state must stay as dispose left
        // it. (`rebuild` already guards this; `install` is the path that missed it.)
        if (disposed)
            return;
        if (rawConfig.enabled === false) {
            uninstall('enabled = false');
            return;
        }
        if (installed !== undefined) {
            // Config changed while active: swap atomically so in-flight requests
            // keep their dispatcher while new ones pick up the new settings.
            const previousMode = mode;
            uninstall('reconfiguring');
            // A reconfigure is one atomic swap, not a fall back to "no dispatcher":
            // restoring the mode keeps the transition line below for real changes only.
            mode = previousMode;
        }
        installed = buildDispatcher(rawConfig, useProxy);
        setGlobalDispatcher(installed);
        setMode(useProxy, reason);
        logger.info(`${useProxy ? 'custom proxy active: host-side fetch traffic routes via' : 'custom proxy direct: host-side fetch traffic goes direct'}` +
            `${useProxy ? ' ' + proxyUrlOf(rawConfig) : ''}` +
            (rawConfig.noProxy?.length > 0 ? ` (bypass: ${rawConfig.noProxy.join(', ')})` : ''));
    };
    const installDirect = (rawConfig, reason) => install(rawConfig, false, reason);
    /**
     * Swap the global dispatcher to a brand-new RoutedDispatcher and retire the
     * old one. Forceful destroys pooled sockets immediately (used after a
     * transport failure); graceful closes only idle sockets so in-flight
     * streaming responses are left alone (used by the periodic reset).
     */
    const rebuild = (reason, forceful) => {
        if (disposed || installed === undefined)
            return;
        const cfg = current();
        if (cfg.enabled === false)
            return;
        const useProxy = shouldUseProxy();
        const old = installed;
        const fresh = buildDispatcher(cfg, useProxy);
        installed = fresh;
        setGlobalDispatcher(fresh);
        lastRebuildAt = Date.now();
        const retire = forceful ? old.destroy() : old.close();
        retire.catch((error) => logger.warn('retiring old dispatcher failed:', error));
        logger.info(`connection pool rebuilt (${reason}${forceful ? ', forceful' : ''})`);
    };
    /** Debounced, backed-off reactive reset: a burst of transport failures triggers one rebuild. */
    const scheduleRebuild = (error) => {
        if (!isAutoReset() || disposed || installed === undefined)
            return;
        // Only while traffic really goes through the proxy: a plain network error on
        // the direct path (bypass-listed host, or a degraded tunnel) must not churn
        // the proxy connection pool.
        if (!shouldUseProxy())
            return;
        if (resetPending)
            return;
        // Exponential backoff on top of the debounce, so a sustained burst cannot
        // destroy the pool on every single failure.
        if (Date.now() - lastRebuildAt < rebuildBackoffMs)
            return;
        resetPending = true;
        setTimeout(() => {
            resetPending = false;
            rebuildBackoffMs = Math.min(rebuildBackoffMs * 2, REBUILD_BACKOFF_MAX_MS);
            rebuild(`transport error: ${error?.code ?? error?.message ?? 'unknown'}`, true);
        }, REBUILD_DEBOUNCE_MS);
    };
    const onTransportError = (error) => {
        scheduleRebuild(error);
    };
    /**
     * Real HTTP probe through a throwaway ProxyAgent: does the tunnel reach the
     * internet? Any HTTP response (2xx/4xx/5xx) proves the bytes flowed.
     */
    const probeUpstream = async (cfg) => {
        const agent = new ProxyAgent({ uri: proxyUrlOf(cfg) });
        try {
            const response = await fetch(cfg.probeUrl ?? DEFAULT_PROBE_URL, {
                method: 'GET',
                dispatcher: agent,
                redirect: 'manual',
                signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            });
            const body = response?.body;
            if (body && typeof body.cancel === 'function')
                body.cancel().catch(() => { });
            return true;
        }
        catch {
            return false;
        }
        finally {
            agent.close().catch(() => { });
        }
    };
    const probe = async () => {
        if (probing || disposed)
            return;
        probing = true;
        try {
            const cfg = current();
            if (cfg.enabled === false) {
                if (alive) {
                    alive = false;
                    uninstall('enabled = false');
                }
                return;
            }
            const host = connectHost(cfg);
            const port = cfg.port ?? 7890;
            const reachable = await probeProxy(host, port, PROBE_TIMEOUT_MS);
            if (reachable !== alive) {
                alive = reachable;
                logger.info(reachable
                    ? `dsh-proxy: proxy reachable at ${host}:${port} — routing through it`
                    : `dsh-proxy: proxy unreachable at ${host}:${port} — falling back to direct`);
            }
            if (!reachable) {
                // The port is gone, so the tunnel verdict goes with it: the next time
                // the port answers it is tried as a proxy before it is judged.
                upstreamHealthy = true;
                upstreamFailures = 0;
            }
            // Decision table (see shouldUseProxy): proxy only while the port answers
            // and the tunnel is healthy; a reachable port with a dead tunnel degrades
            // to direct instead of staying on it.
            const useProxy = shouldUseProxy();
            if (installed === undefined || mode !== (useProxy ? 'proxy' : 'direct')) {
                if (useProxy)
                    install(cfg, true, 'port-reachable');
                else
                    installDirect(cfg, reachable ? 'upstream-unreachable' : 'port-unreachable');
            }
            // Upstream probe (every N-th cycle), gated only on the port being
            // reachable — NOT on the routing mode, so a degraded tunnel keeps being
            // probed and can come back on its own.
            if (alive && isAutoReset() && installed !== undefined) {
                probeCounter += 1;
                // Every N-th cycle normally; every cycle while the tunnel is degraded, so
                // recovery does not have to wait for a whole probe interval.
                const dueUpstream = probeCounter % UPSTREAM_PROBE_EVERY === 0 || !upstreamHealthy;
                if (dueUpstream) {
                    const up = await probeUpstream(cfg);
                    // Disposal may have landed while the probe was in flight; stop rather
                    // than acting on a verdict about an endpoint this fiber no longer owns.
                    if (disposed)
                        return;
                    if (up) {
                        upstreamHealthy = true;
                        upstreamFailures = 0;
                        rebuildBackoffMs = REBUILD_DEBOUNCE_MS;
                        if (mode !== 'proxy')
                            install(cfg, true, 'upstream-recovered');
                    }
                    else {
                        upstreamFailures += 1;
                        if (upstreamHealthy) {
                            logger.warn('dsh-proxy: upstream probe failed — rebuilding connection pool');
                            rebuild('upstream probe failed', true);
                            if (upstreamFailures >= UPSTREAM_FAIL_THRESHOLD) {
                                upstreamHealthy = false;
                                // Degrade for real. The probe above keeps running, so the next
                                // successful upstream probe switches straight back to proxy.
                                installDirect(cfg, `upstream-unreachable failures=${upstreamFailures}`);
                            }
                        }
                    }
                }
            }
        }
        catch (error) {
            logger.warn('dsh-proxy: proxy probe failed:', error);
            if (alive) {
                alive = false;
                upstreamHealthy = true;
                upstreamFailures = 0;
                installDirect(current(), 'port-unreachable');
            }
        }
        finally {
            probing = false;
        }
    };
    // Start direct (no proxy interception of the TLS path) so a restart while the
    // proxy is down never strands the process; the probe flips to proxy once the
    // port answers. With enabled=false this is a no-op and nothing is installed.
    installDirect(current(), 'startup');
    void probe();
    timer = setInterval(() => void probe(), PROBE_INTERVAL_MS);
    if (RESET_INTERVAL_MS > 0) {
        resetTimer = setInterval(() => {
            if (isAutoReset() && installed !== undefined && current().enabled !== false) {
                rebuild('periodic reset', false);
            }
        }, RESET_INTERVAL_MS);
    }
    // Register the settings namespace so a configuration surface can edit this
    // section live. Runs only while a settings service is present.
    ctx.inject(['settings'], (sctx) => {
        sctx.settings.installSection(ctx, NS, Config, config, {
            setSource: (source) => {
                current = source;
            },
            onChange: () => {
                try {
                    // host/port/enabled/autoReset/probeUrl may have changed:
                    // drop to direct, then re-probe immediately against the new settings.
                    // The tunnel verdict belongs to the old endpoint, so it is reset too.
                    alive = false;
                    upstreamHealthy = true;
                    upstreamFailures = 0;
                    installDirect(current(), 'reconfigured');
                    void probe();
                }
                catch (error) {
                    logger.error('dsh-proxy: keeping the previous dispatcher after a refused update');
                    logger.error(error);
                }
            },
        });
    });
    const events = ctx;
    events.on?.('dispose', () => {
        disposed = true;
        if (timer !== undefined)
            clearInterval(timer);
        if (resetTimer !== undefined)
            clearInterval(resetTimer);
        uninstall('plugin unloaded');
    });
}
export default { name, inject, Config, apply };
