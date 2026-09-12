import Schema from '@deepseek-ai/schemastery';
import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
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
const UPSTREAM_TIMEOUT_MS = 3000;
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
    /** Wall-clock ms when the tunnel was last judged broken (for the status readout). */
    let tunnelBrokenAt;
    /** Routing mode of the installed dispatcher (undefined while none is installed). */
    let mode;
    /** Backoff window currently enforced between reactive rebuilds. */
    let rebuildBackoffMs = REBUILD_DEBOUNCE_MS;
    /** When the last rebuild happened, measured against rebuildBackoffMs. */
    let lastRebuildAt = 0;
    /**
     * When a request last died on the wire while we were routing through the proxy.
     * This arrives BEFORE the model layer turns the failure into user-visible text,
     * which is what lets that very text be corrected (see decorateTunnelFailures).
     */
    let proxiedTransportErrorAt = 0;
    // Liveness and upstream probing hold SEPARATE in-flight guards. One shared guard
    // let a stuck upstream probe (up to UPSTREAM_TIMEOUT_MS) starve the 2-second
    // liveness probe, so a port that had disappeared went unnoticed for the whole
    // upstream timeout — measured at 8,008 ms against a 200 ms cadence.
    let probingLiveness = false;
    let probingUpstream = false;
    let disposed = false;
    let timer;
    let resetTimer;
    let resetPending = false;
    let probeCounter = 0;
    const isAutoReset = () => current().autoReset !== false;
    /**
     * Routing decision. Policy: the tunnel is NEVER abandoned automatically. While
     * the proxy port answers, host-side traffic keeps going through the proxy even
     * if the tunnel looks broken — silently leaving it would move every request off
     * the tunnel, and only the user knows whether direct reaches the destinations
     * they care about. A port that is not listening is different: there is no tunnel
     * to use, which is exactly the "VPN off = direct" case.
     */
    const shouldUseProxy = () => alive;
    /**
     * Whether churning the connection pool can plausibly help. A rebuild cannot
     * repair a tunnel already judged broken, and rebuilding on every failed request
     * while it is down would only add load, so reactive rebuilds stay gated on the
     * tunnel verdict even though routing does not.
     */
    const rebuildHelps = () => alive && upstreamHealthy;
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
        // A rebuild cannot repair a tunnel already judged broken, and rebuilding on
        // every failed request while it is down would only add load. Routing stays on
        // the proxy either way; only the pool churn is gated here (S11).
        if (!rebuildHelps())
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
        // A request that failed on the wire while we are routing through the proxy is
        // evidence about the tunnel. Recorded here, not at the probe, so the verdict
        // can be reached from real traffic instead of waiting for the next cycle.
        if (mode === 'proxy')
            proxiedTransportErrorAt = Date.now();
        scheduleRebuild(error);
    };
    /** How long a wire failure keeps the tunnel under suspicion. */
    const TUNNEL_SUSPECT_MS = 30000;
    /** Whether a failed model request plausibly died because the tunnel is down. */
    const tunnelIsSuspect = () => mode === 'proxy'
        && (!upstreamHealthy || Date.now() - proxiedTransportErrorAt < TUNNEL_SUSPECT_MS);
    /**
     * Make a model request that died on the wire say so in Chinese.
     *
     * The adapter wraps every transport failure in a fixed English sentence
     * (`DeepSeek API stream from <baseURL> failed`) and `normalizeLlmFailure` keeps
     * ONLY that message — the underlying cause never reaches the user, and because
     * the result is an `LlmError` the cause-chain renderer is not used either. So
     * rewriting the original error is pointless.
     *
     * The last place the text is still ours is the terminal `finish` chunk:
     * agent-loop builds its error from exactly `finish.failure.message`, and that is
     * what lands in `turn/end` and therefore in the conversation. Rewriting it
     * changes only the wording — `code` stays `TRANSPORT`, so retry policy, error
     * classification, and every consumer that routes on the code are unaffected.
     */
    const maybeRenameTunnelFailure = (chunk) => {
        if (chunk?.type !== 'finish')
            return chunk;
        const reason = chunk.reason;
        if (reason?.kind !== 'error' || reason.failure?.code !== 'TRANSPORT')
            return chunk;
        if (!tunnelIsSuspect())
            return chunk;
        const failure = reason.failure;
        // Hedged on purpose: a wire failure through the proxy can also mean the
        // upstream itself is unreachable, and asserting "the node is dead" would be
        // wrong in exactly the case where it matters most.
        return {
            ...chunk,
            reason: {
                ...reason,
                failure: {
                    ...failure,
                    message: `${failure.message}\n`
                        + 'dsh-proxy: 这次模型请求经代理出站失败 —— 隧道不通（常见原因是代理节点挂了）。'
                        + '请切换到可用节点，或关闭代理改走直连后重试。',
                },
            },
        };
    };
    /** Wrap one model-call stream so a suspect tunnel failure is reported in Chinese. */
    const decorateTunnelFailures = (source) => ({
        async *[Symbol.asyncIterator]() {
            for await (const chunk of source)
                yield maybeRenameTunnelFailure(chunk);
        },
    });
    /** A parseable HTTP status line — the proof that a real response came back. */
    const STATUS_LINE = /^HTTP\/1\.[01] \d{3}/;
    /**
     * The tunnel probe: ONE connection, end to end, and no retry loop.
     *
     * Deliberately not `fetch` through a throwaway ProxyAgent. undici retries a
     * request whose connection closed before a response arrived, so against a proxy
     * that accepts and then resets (a dead node) a single probe became a retry storm
     * — measured at 23,532–25,432 requests inside the abort window, aimed at the
     * LOCAL proxy — and it could only conclude when that timeout expired (8,005 ms
     * against a proxy that simply never answers).
     *
     * Doing the round trip by hand keeps the check genuinely end-to-end (real
     * CONNECT, real TLS handshake, real HTTP request to the real upstream) while
     * making it exactly one request with a timeout we choose. Sensitivity is
     * therefore unchanged: a response is still required to call the tunnel healthy.
     */
    const probeUpstream = (cfg, timeoutMs) => new Promise((resolve) => {
        const target = new URL(cfg.probeUrl ?? DEFAULT_PROBE_URL);
        const secure = target.protocol === 'https:';
        const targetPort = Number(target.port === '' ? (secure ? 443 : 80) : target.port);
        const proxyHost = connectHost(cfg);
        const proxyPort = cfg.port ?? 7890;
        let settled = false;
        let timer;
        let proxySocket;
        let stream;
        const finish = (ok) => {
            if (settled)
                return;
            settled = true;
            if (timer !== undefined)
                clearTimeout(timer);
            stream?.destroy();
            proxySocket?.destroy();
            resolve(ok);
        };
        const requestUpstream = (transport) => {
            stream = transport;
            transport.on('data', (chunk) => {
                if (STATUS_LINE.test(chunk.toString('latin1')))
                    finish(true);
            });
            transport.once('error', () => finish(false));
            transport.once('close', () => finish(false));
            // Plain HTTP goes to the proxy in absolute form; over a tunnel only the
            // origin-form target is sent.
            const requestTarget = secure ? `${target.pathname}${target.search}` : target.href;
            transport.write(`GET ${requestTarget} HTTP/1.1\r\n`
                + `Host: ${target.host}\r\n`
                + 'User-Agent: dsh-proxy-probe\r\n'
                + 'Accept: */*\r\n'
                + 'Connection: close\r\n\r\n');
        };
        timer = setTimeout(() => finish(false), timeoutMs);
        proxySocket = connect({ host: proxyHost, port: proxyPort });
        proxySocket.once('error', () => finish(false));
        proxySocket.once('connect', () => {
            if (settled)
                return;
            if (!secure) {
                requestUpstream(proxySocket);
                return;
            }
            let head = '';
            const onHead = (chunk) => {
                head += chunk.toString('latin1');
                if (!head.includes('\r\n\r\n'))
                    return;
                proxySocket?.off('data', onHead);
                const status = Number(head.slice(0, head.indexOf('\r\n')).split(' ')[1]);
                if (!(status >= 200 && status < 300)) {
                    finish(false);
                    return;
                }
                // Speak TLS *inside* the tunnel: accepting a CONNECT is not the same as
                // being able to carry traffic, and a probe that stopped at CONNECT would
                // call a broken node healthy.
                const tls = tlsConnect({ socket: proxySocket, servername: target.hostname });
                tls.once('secureConnect', () => requestUpstream(tls));
                tls.once('error', () => finish(false));
            };
            proxySocket?.on('data', onHead);
            proxySocket?.write(`CONNECT ${target.hostname}:${targetPort} HTTP/1.1\r\n`
                + `Host: ${target.hostname}:${targetPort}\r\n\r\n`);
        });
    });
    /** Forget the tunnel verdict — it described an endpoint we are no longer judging. */
    const clearTunnelVerdict = () => {
        const wasBroken = !upstreamHealthy;
        upstreamHealthy = true;
        upstreamFailures = 0;
        tunnelBrokenAt = undefined;
        if (wasBroken)
            logger.info('dsh-proxy: 隧道判定已重置（端口消失或配置变更），下次端口可达时重新判定');
    };
    /**
     * Record that the tunnel is broken WITHOUT leaving it, and say so in Chinese.
     * Nothing is rerouted here: the user asked to be told, not to be moved.
     */
    const markTunnelBroken = () => {
        if (!upstreamHealthy)
            return;
        upstreamHealthy = false;
        tunnelBrokenAt = Date.now();
        // Keep the probe URL OUT of the middle of this line. The host log
        // percent-encodes everything following a bare URL it finds in the text, which
        // turned the actionable half of this warning into %E8%AF%B7%E5%88%87… and made
        // it unreadable (observed in a real run, 2026-09-12 17:47). The URL goes last,
        // where nothing follows it to mangle.
        logger.warn(`dsh-proxy: 隧道坏了（代理节点不可达）——上游探测 ${upstreamFailures} 次连续失败。`
            + '请切换到可用节点，或关闭代理改走直连。按当前设置插件不会自动改走直连。');
        logger.warn(`dsh-proxy: 探测目标 ${current().probeUrl ?? DEFAULT_PROBE_URL}`);
    };
    /**
     * Port liveness only: cheap, on its own cadence, and never blocked by the
     * upstream probe. This is the only probe allowed to move traffic between the
     * proxy and direct.
     */
    const probeLiveness = async () => {
        if (probingLiveness || disposed)
            return;
        probingLiveness = true;
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
            if (!reachable)
                clearTunnelVerdict();
            // Only the port decides routing; the tunnel verdict never does (see shouldUseProxy).
            const useProxy = shouldUseProxy();
            if (installed === undefined || mode !== (useProxy ? 'proxy' : 'direct')) {
                if (useProxy)
                    install(cfg, true, 'port-reachable');
                else
                    installDirect(cfg, 'port-unreachable');
            }
        }
        catch (error) {
            logger.warn('dsh-proxy: proxy probe failed:', error);
            if (alive) {
                alive = false;
                clearTunnelVerdict();
                installDirect(current(), 'port-unreachable');
            }
        }
        finally {
            probingLiveness = false;
        }
    };
    /**
     * Tunnel health: the expensive end-to-end check, on its own guard so it can
     * never delay liveness. Under the current policy it reroutes nothing — it only
     * maintains the verdict the user is told about.
     */
    const probeUpstreamCycle = async () => {
        if (probingUpstream || disposed)
            return;
        if (!alive || !isAutoReset() || installed === undefined)
            return;
        const cfg = current();
        if (cfg.enabled === false)
            return;
        probingUpstream = true;
        try {
            probeCounter += 1;
            // Every N-th cycle normally; every cycle while the tunnel is broken, so
            // recovery does not have to wait for a whole probe interval.
            if (probeCounter % UPSTREAM_PROBE_EVERY !== 0 && upstreamHealthy)
                return;
            const up = await probeUpstream(cfg, UPSTREAM_TIMEOUT_MS);
            // Disposal may have landed while the probe was in flight; stop rather than
            // acting on a verdict about an endpoint this fiber no longer owns.
            if (disposed)
                return;
            if (up) {
                const wasBroken = !upstreamHealthy;
                upstreamHealthy = true;
                upstreamFailures = 0;
                tunnelBrokenAt = undefined;
                rebuildBackoffMs = REBUILD_DEBOUNCE_MS;
                if (wasBroken)
                    logger.info('dsh-proxy: 隧道已恢复（上游探测成功），继续经代理出站');
            }
            else {
                upstreamFailures += 1;
                if (upstreamHealthy) {
                    logger.warn('dsh-proxy: upstream probe failed — rebuilding connection pool');
                    rebuild('upstream probe failed', true);
                    if (upstreamFailures >= UPSTREAM_FAIL_THRESHOLD)
                        markTunnelBroken();
                }
            }
        }
        finally {
            probingUpstream = false;
        }
    };
    // Start direct (no proxy interception of the TLS path) so a restart while the
    // proxy is down never strands the process; the probe flips to proxy once the
    // port answers. With enabled=false this is a no-op and nothing is installed.
    installDirect(current(), 'startup');
    void probeLiveness();
    timer = setInterval(() => {
        // Two independent probes behind two independent guards: a slow upstream check
        // must never delay noticing that the proxy port appeared or disappeared.
        void probeLiveness();
        void probeUpstreamCycle();
    }, PROBE_INTERVAL_MS);
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
                    clearTunnelVerdict();
                    installDirect(current(), 'reconfigured');
                    void probeLiveness();
                }
                catch (error) {
                    logger.error('dsh-proxy: keeping the previous dispatcher after a refused update');
                    logger.error(error);
                }
            },
        });
    });
    const events = ctx;
    /**
     * Read-only status for the settings card. With policy B a broken tunnel changes
     * no routing, so this readout is the user's only way to see the verdict without
     * reading the host log.
     */
    const statusSnapshot = () => {
        const cfg = current();
        const enabled = cfg.enabled !== false;
        return {
            enabled,
            host: connectHost(cfg),
            port: cfg.port ?? 7890,
            routing: !enabled ? 'disabled' : (mode ?? 'starting'),
            tunnel: upstreamHealthy ? 'ok' : 'broken',
            tunnelBrokenAt: tunnelBrokenAt ?? null,
            upstreamFailures,
            probeUrl: cfg.probeUrl ?? DEFAULT_PROBE_URL,
            upstreamTimeoutMs: UPSTREAM_TIMEOUT_MS,
            probeIntervalMs: PROBE_INTERVAL_MS,
        };
    };
    // Serve that snapshot to the browser half. Deliberately read-only, no secrets
    // (host/port/flags only), loopback-only, and composed only when a web server
    // exists — a headless run simply has none.
    ctx.inject(['webServer'], (wctx) => {
        // No type augmentation for this service is available here (the plugin does not
        // depend on the web-server package), so the shape is declared locally.
        const web = wctx.webServer;
        web.register({
            kind: 'exact',
            path: '/dsh-proxy/status',
            handler: (req, res) => {
                const remote = String(req?.socket?.remoteAddress ?? '');
                const loopback = remote === '::1' || remote === '::ffff:127.0.0.1' || remote.startsWith('127.');
                if (!loopback) {
                    res.statusCode = 403;
                    res.end('forbidden');
                    return;
                }
                res.statusCode = 200;
                res.setHeader?.('content-type', 'application/json');
                res.setHeader?.('cache-control', 'no-store');
                res.end(JSON.stringify(statusSnapshot()));
            },
        });
    });
    // A waterfall listener wraps every streaming model call and rewrites the terminal
    // failure of a suspect tunnel in Chinese (see decorateTunnelFailures). Optional:
    // a composition without the llm runtime simply never emits this.
    const waterfalls = ctx;
    waterfalls.on?.('llm/stream', (...args) => {
        const next = args[args.length - 1];
        if (typeof next !== 'function')
            return undefined;
        return decorateTunnelFailures(next());
    });
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
