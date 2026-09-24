import Schema from '@deepseek-ai/schemastery';
import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { Agent, Dispatcher, Pool, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher, } from 'undici';
/**
 * Why this plugin must run on undici 8, and what breaks on 7.
 *
 * Node's built-in `fetch` does not own its dispatcher: it reads the
 * `Symbol.for('undici.globalDispatcher.1')` slot when a request starts. undici 8
 * keeps that legacy slot working by wrapping whatever is installed in a
 * `Dispatcher1Wrapper`, which bridges the legacy (`.1`) handler built-in `fetch`
 * passes down to the modern (`.2`) handler a current undici dispatcher expects.
 *
 * An undici 7 dispatcher placed in that slot gets no such bridge, and the
 * request never completes: the proxy is never dialled and `fetch()` hangs until
 * its own abort fires. Measured on Node 24.21 with the 0.3.1 build — an undici-7
 * `ProxyAgent` at the slot produced `TimeoutError` with zero requests reaching
 * the proxy, while the same test under undici 8 returned the proxied response.
 * A build like that looks "installed and working": routing decisions, host logs,
 * and the status card all report success while every request keeps going direct.
 *
 * The coupling is on the SLOT, not on an exact version: a dispatcher built by
 * any undici 8 copy (this plugin's own, or the one the harness ships) is
 * compatible, because both write `.1` through the same wrapper.
 */
export const name = 'dsh-proxy';
export const inject = {};
/** Settings namespace this plugin owns; the browser card pairs with it. */
export const NS = 'dsh-proxy';
/**
 * Read one field, whether it arrived as a volatile reference or plainly.
 *
 * A volatile reference is a live cell the Loader commits new values into
 * without remounting this plugin, so it must be read at use time and never
 * cached; `undefined` from an absent reference falls back to the default.
 */
export function readField(field, fallback) {
    if (field === undefined || field === null)
        return fallback;
    const ref = field;
    if (typeof ref.get === 'function')
        return ref.get() ?? fallback;
    return field;
}
/**
 * Snapshot the whole config. Every field is volatile, so the result is a plain
 * value that the network layer can hold without observing later edits.
 */
export function readConfig(raw) {
    return {
        enabled: readField(raw?.enabled, true),
        host: readField(raw?.host, '127.0.0.1'),
        port: readField(raw?.port, 7890),
        noProxy: readField(raw?.noProxy, DEFAULT_NO_PROXY),
        autoReset: readField(raw?.autoReset, true),
        probeUrl: readField(raw?.probeUrl, DEFAULT_PROBE_URL),
    };
}
/**
 * Every field is `.volatile()`.
 *
 * The harness exposes exactly the fields its settings form may edit: a field
 * whose schema node is not volatile is ordinary composition configuration, is
 * invisible to the form, and can only change by rewriting the profile patch and
 * restarting the entry. Marking the whole schema volatile is what makes the
 * card on the Plugins page able to write a new host or port that the running
 * plugin picks up immediately — the Loader commits the new value into the
 * reference in place (no remount) and emits `loader/volatile-update`, which is
 * what this plugin listens for.
 */
export const Config = Schema.object({
    enabled: Schema.boolean()
        .default(true)
        .description('启用自定义代理。关闭后恢复 DSH 宿主进程原来的网络方式。')
        .volatile(),
    host: Schema.string()
        .default('127.0.0.1')
        .description('代理服务器地址，例如 127.0.0.1（Clash/mihomo 本机混合端口）。')
        .volatile(),
    port: Schema.natural()
        .max(65535)
        .default(7890)
        .description('代理服务器端口，例如 7890（Clash/mihomo 混合端口）。')
        .volatile(),
    noProxy: Schema.array(String)
        .default(['localhost', '127.0.0.1', '::1', '[::1]'])
        .description('绕过代理的主机名单：精确匹配主机名，或以 . 开头匹配域名后缀（如 .lan）。')
        .volatile(),
    autoReset: Schema.boolean()
        .default(true)
        .description('自动重建连接池：检测到上游断开或请求发生传输层错误时，销毁并重建连接池，避免复用失效连接。')
        .volatile(),
    probeUrl: Schema.string()
        .default('https://api.deepseek.com/models')
        .description('上游连通性探测地址：插件会定期用这个地址发起真实请求（穿过代理）来判断代理上游隧道是否可用。')
        .volatile(),
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
 * Intercept a DispatchHandler's failure callback to report transport failures.
 *
 * Which callback that is depends on the handler generation undici handed us: the
 * modern (`.2`) contract reports failure through
 * `onResponseError(controller, error)` and names no `onError` at all, while the
 * legacy (`.1`) contract calls `onError(error)`. Both are honoured, so the same
 * dispatcher serves this harness's `.2` call path (reached through undici 8's
 * `Dispatcher1Wrapper`) and a direct `.1` caller.
 *
 * The returned handler is a plain object holding BOUND references to the
 * original's methods. Neither prototype delegation (`Object.create`) nor a
 * `Proxy` works here: the handler undici hands us is a `LegacyHandlerWrapper`
 * whose methods read a `#handler` private field, and both of those change the
 * receiver, so `this.#handler` is read off the wrong instance. Measured on Node
 * 24.21 with undici 8: the request dies with `Cannot read private member #handler
 * from an object whose class did not declare it`, surfaced to the user as a bare
 * `fetch failed` in place of the real transport error.
 * @param handler - the dispatch handler to wrap.
 * @param onTransportError - called for each failure that looks like a transport failure.
 * @returns a handler that forwards every call unchanged and observes failures.
 */
function wrapHandler(handler, onTransportError) {
    if (!handler || typeof handler !== 'object')
        return handler;
    const modern = typeof handler.onResponseError === 'function';
    const key = modern
        ? 'onResponseError'
        : typeof handler.onError === 'function' ? 'onError' : undefined;
    if (key === undefined)
        return handler;
    const original = handler[key];
    const wrapped = {};
    for (const own of Object.getOwnPropertyNames(handler)) {
        const value = handler[own];
        wrapped[own] = typeof value === 'function' ? value.bind(handler) : value;
    }
    // Methods that live on the prototype instead of the instance are not reached
    // by the own-property pass above; copy the ones any handler generation uses.
    for (const own of ['onError', 'onResponseError', 'onConnect', 'onHeaders', 'onData',
        'onComplete', 'onRequestStart', 'onResponseStart', 'onResponseData', 'onResponseEnd']) {
        if (typeof handler[own] === 'function')
            wrapped[own] = handler[own].bind(handler);
    }
    wrapped[key] = (...args) => {
        const error = modern ? args[1] : args[0];
        try {
            if (isTransportError(error))
                onTransportError(error);
        }
        catch {
            /* never let the hook break dispatch */
        }
        return original.apply(handler, args);
    };
    return wrapped;
}
/**
 * Space out proxy traffic, unconditionally.
 *
 * Why unconditional: the failure mode this guards is a proxy that ACCEPTS the TCP
 * connection and then resets when the request arrives, so the connector's callback
 * SUCCEEDS (`err == null`) and the failure only surfaces later. A "slow down after a
 * failed dial" rule therefore never fires — measured: the plugin still made 11,282
 * connections in 3 s with such a rule, versus 8 with an unconditional one.
 *
 * Routing is unchanged: traffic still goes through the proxy (policy B never abandons
 * the tunnel on its own, and pacing is not a routing decision), and the failure is
 * still the proxy's own transport error — so the TRANSPORT classification, the retry
 * policy, and the Chinese diagnostics are all untouched.
 *
 * Where it is enforced, and why that moved: the guard used to wrap the connector
 * `ProxyAgent` handed to its `clientFactory`. undici 8 stopped passing one, so the
 * same interval is now enforced one level up, by spacing calls into the proxy pool
 * ({@link PaceProxyDials}), with the connector wrap kept for any undici that still
 * supplies it.
 *
 * What it costs in the healthy case: a call is forwarded at once whenever the window
 * is open and nothing is queued, so a single pooled request — the normal case, measured
 * at 1 connection / 14 ms / 200 OK — is never delayed. Bursts wait their turn; the
 * failing case goes from thousands of dials per second to under three.
 */
const PROXY_DIAL_INTERVAL_MS = 400;
/**
 * Wrap a connector so consecutive dials are spaced by at least `minIntervalMs`.
 *
 * A missing connector is passed straight through: undici 8 stopped handing the
 * proxy dial connector to `ProxyAgent.clientFactory` (it builds its own
 * `Http1ProxyWrapper`/`Agent` internally), so whoever calls this must be ready
 * for `undefined` rather than turning every dial into
 * `connect is not a function`. See {@link PaceProxyDials} for the limiter that
 * took over the job on that undici.
 * @param connect - the connector ProxyAgent handed us, when it still does.
 * @param minIntervalMs - minimum spacing between dials.
 * @returns a connector with the same contract.
 */
function paceDials(connect, minIntervalMs) {
    if (typeof connect !== 'function')
        return connect;
    let nextAllowedAt = 0;
    return (opts, callback) => {
        const now = Date.now();
        const wait = Math.max(0, nextAllowedAt - now);
        nextAllowedAt = Math.max(now, nextAllowedAt) + minIntervalMs;
        if (wait === 0)
            connect(opts, callback);
        else
            setTimeout(() => connect(opts, callback), wait);
    };
}
/**
 * A dispatcher facade that spaces the calls it forwards, one at a time.
 *
 * Why this exists on top of {@link paceDials}: undici 8 no longer passes a
 * connector to `ProxyAgent.clientFactory`, so the connector-level pacing has
 * nothing to wrap there. Wrapping `dispatch` instead keeps the guard's actual
 * purpose — a proxy that accepts the connection and then resets must not be
 * hammered with thousands of re-dials — while staying above the transport
 * details that moved.
 *
 * Delivery is not dropped: when a call would fall inside the spacing window it is
 * acknowledged (`true`) and the same opts/handler pair is forwarded once the
 * window opens. A healthy pooled request is usually the only call in flight, so
 * its dispatch is immediate and unthrottled; bursts — the failing case — are
 * serialized at `minIntervalMs` apart.
 */
class PaceProxyDials extends Dispatcher {
    inner;
    minIntervalMs;
    /** When the next forward may happen. */
    nextAllowedAt = 0;
    /** Calls acknowledged early and waiting for their slot. */
    queue = [];
    drainTimer;
    closed = false;
    /**
     * @param inner - the dispatcher whose calls are spaced — the proxy pool.
     * @param minIntervalMs - minimum spacing between consecutive forwarded calls.
     */
    constructor(inner, minIntervalMs) {
        super();
        this.inner = inner;
        this.minIntervalMs = minIntervalMs;
    }
    dispatch(opts, handler) {
        if (this.closed)
            return false;
        const now = Date.now();
        if (this.queue.length === 0 && now >= this.nextAllowedAt) {
            this.nextAllowedAt = now + this.minIntervalMs;
            return this.inner.dispatch(opts, handler);
        }
        this.queue.push({ opts, handler });
        this.scheduleDrain();
        return true;
    }
    /** Forward one queued call per spacing window until the queue is empty. */
    scheduleDrain() {
        if (this.drainTimer !== undefined || this.closed)
            return;
        const wait = Math.max(0, this.nextAllowedAt - Date.now());
        this.drainTimer = setTimeout(() => {
            this.drainTimer = undefined;
            if (this.closed)
                return;
            const next = this.queue.shift();
            if (next === undefined)
                return;
            this.nextAllowedAt = Date.now() + this.minIntervalMs;
            try {
                this.inner.dispatch(next.opts, next.handler);
            }
            catch (error) {
                // A queued call that cannot be forwarded must still fail loudly for its
                // caller, in the handler contract's own shape.
                ;
                next.handler.onResponseError?.(undefined, error);
                next.handler.onError?.(error);
            }
            this.scheduleDrain();
        }, wait);
    }
    async close() {
        this.closed = true;
        if (this.drainTimer !== undefined)
            clearTimeout(this.drainTimer);
        this.drainTimer = undefined;
        this.queue.length = 0;
        return this.inner.close();
    }
    async destroy() {
        this.closed = true;
        if (this.drainTimer !== undefined)
            clearTimeout(this.drainTimer);
        this.drainTimer = undefined;
        this.queue.length = 0;
        return this.inner.destroy();
    }
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
        // `clientFactory(origin, { connect })` is where ProxyAgent exposed the
        // connector it dials the proxy with in undici 7 — the only place the re-dial
        // storm could be paced. undici 8 stopped passing that connector, so this
        // stays for the undici that still does, and the spacing moved up to
        // `dispatch` (see PaceProxyDials).
        const pool = new ProxyAgent({
            uri: proxyUrl,
            clientFactory: (origin, opts) => new Pool(origin, { ...opts, connect: paceDials(opts.connect, PROXY_DIAL_INTERVAL_MS) }),
        });
        this.proxied = new PaceProxyDials(pool, PROXY_DIAL_INTERVAL_MS);
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
/**
 * Whether two config snapshots need a different dispatcher: the endpoint moved
 * (host/port), the bypass list changed, or a behaviour flag flipped.
 *
 * Compared field by field against the schema defaults rather than by object
 * identity, because every read rebuilds the snapshot.
 * @param left - the config the running dispatcher was built from.
 * @param right - the config that stands now.
 * @returns whether the installed dispatcher must be replaced.
 */
export function configDiffers(left, right) {
    const sameList = (a, b) => {
        const x = a ?? DEFAULT_NO_PROXY;
        const y = b ?? DEFAULT_NO_PROXY;
        return x.length === y.length && x.every((entry, index) => entry === y[index]);
    };
    return (left.enabled ?? true) !== (right.enabled ?? true)
        || (left.host ?? '127.0.0.1') !== (right.host ?? '127.0.0.1')
        || (left.port ?? 7890) !== (right.port ?? 7890)
        || (left.autoReset ?? true) !== (right.autoReset ?? true)
        || (left.probeUrl ?? DEFAULT_PROBE_URL) !== (right.probeUrl ?? DEFAULT_PROBE_URL)
        || !sameList(left.noProxy, right.noProxy);
}
export function apply(ctx, rawConfig) {
    const logger = ctx.logger(name);
    // Snapshot the dispatcher that was global when the plugin loaded. Restoring
    // it on dispose keeps unload symmetric even if other code chained its own
    // dispatcher on top of ours in between.
    const previous = getGlobalDispatcher();
    let installed;
    /**
     * Live configuration. Rebuilt on every read: each field is a volatile
     * reference the Loader commits new values into IN PLACE, so caching a
     * snapshot here would freeze the plugin on whatever stood when it mounted.
     */
    let current = () => readConfig(rawConfig);
    /**
     * The config the installed dispatcher was built from. Comparing it against a
     * fresh read is what detects an endpoint move; doing it on the liveness tick
     * (rather than trusting the update event alone) keeps the plugin correct even
     * if that notification is never delivered.
     */
    let appliedConfig;
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
        appliedConfig = undefined;
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
        appliedConfig = { ...rawConfig };
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
        appliedConfig = { ...cfg };
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
            // The endpoint moved under a running dispatcher (host/port/noProxy/flags
            // edited on the settings card). Drop to direct first so the reachability
            // probe below rebuilds from the NEW endpoint, and forget a tunnel verdict
            // that described the old one. This is the safety net behind the
            // `loader/volatile-update` listener: config is re-read here on every tick,
            // so a missed notification delays the switch by one interval, never loses it.
            if (installed !== undefined && appliedConfig !== undefined && configDiffers(appliedConfig, cfg)) {
                alive = false;
                clearTunnelVerdict();
                installDirect(cfg, 'reconfigured');
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
            // The port may also have vanished while we waited. The verdict then belongs
            // to an endpoint that is gone: liveness has already reset it and routed
            // direct, so reporting "the node is unreachable" here would name the wrong
            // cause — the user turned the VPN off, not the node. Observed 2026-09-12
            // 18:01:21: the port disappeared, we correctly went direct, and a stale
            // in-flight probe then re-marked the tunnel broken 3 ms later.
            if (!alive)
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
    const events = ctx;
    /**
     * There is no settings-namespace registration to perform any more.
     *
     * In this harness a plugin's editable configuration IS its own Loader entry:
     * the framework derives the form from the exported `Config` schema and writes
     * edits into the profile patch, keyed by the entry id. So this plugin declares
     * nothing — it only has to read its volatile references live (see `current`)
     * and react when the Loader commits new values.
     *
     * The browser card addresses this entry by that same row id, which the bundle
     * patch fixes to `NS`. A composition mounting the plugin under another id
     * would leave the card silently absent, so name that case in the log.
     */
    try {
        const self = ctx;
        const entryId = self.loader?.locate(self.fiber);
        if (entryId !== undefined && entryId !== NS) {
            logger.warn(`dsh-proxy: mounted as Loader entry "${entryId}", but its settings card is keyed on "${NS}" — `
                + `the card will not appear. Mount the plugin with \`id: ${NS}\`.`);
        }
    }
    catch {
        /* diagnostics only: a host without a Loader must still load the plugin */
    }
    /**
     * React to a live config commit.
     *
     * A settings write lands in the profile patch and the Loader commits the new
     * values into this plugin's volatile references IN PLACE — no remount, no
     * second `apply`. `loader/volatile-update` is the only signal, and it is
     * dispatched to this fiber alone. Without it an endpoint move would still be
     * caught by the liveness tick's drift check, but a tick is up to
     * PROBE_INTERVAL_MS of traffic still aimed at the old endpoint.
     */
    events.on?.('loader/volatile-update', () => {
        if (disposed)
            return;
        try {
            // host/port/enabled/autoReset/probeUrl may have changed: drop to direct,
            // then re-probe immediately against the new settings. The tunnel verdict
            // belongs to the old endpoint, so it is reset too.
            alive = false;
            clearTunnelVerdict();
            installDirect(current(), 'reconfigured');
            void probeLiveness();
        }
        catch (error) {
            logger.error('dsh-proxy: keeping the previous dispatcher after a refused update');
            logger.error(error);
        }
    });
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
        // Route registration is NOT fiber-scoped: `WebServer.register` only returns a
        // disposer, and it throws on a duplicate (kind, path). Registering one without
        // claiming it on this fiber's effects leaks the route, so the plugin's next
        // reload — a hot profile recomposition, or disable/enable in the GUI — dies on
        // `webserver: duplicate exact route "/dsh-proxy/status"`.
        wctx.effect(() => web.register({
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
        }), 'dsh-proxy: status route');
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
