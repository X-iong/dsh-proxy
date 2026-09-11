import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { connect } from 'node:net'
import {
  Agent,
  Dispatcher,
  ProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici'

export const name = 'dsh-proxy'
export const inject = {}

/** Settings namespace this plugin owns; the browser card pairs with it. */
export const NS = 'dsh-proxy'

export interface ProxyConfig {
  enabled?: boolean
  host?: string
  port?: number
  noProxy?: string[]
  autoReset?: boolean
  probeUrl?: string
}

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
})

const DEFAULT_NO_PROXY = ['localhost', '127.0.0.1', '::1', '[::1]']
const DEFAULT_PROBE_URL = 'https://api.deepseek.com/models'
/** How often to re-check whether the proxy port is listening. */
const PROBE_INTERVAL_MS = 10000
/** TCP connect timeout for one liveness probe. */
const PROBE_TIMEOUT_MS = 2000
/** Upstream fetch timeout: how long a probe request may take before we treat the tunnel as broken. */
const UPSTREAM_TIMEOUT_MS = 8000
/** Graceful periodic pool reset interval. */
const RESET_INTERVAL_MS = 60000
/** Run the upstream probe every N-th liveness cycle (N * PROBE_INTERVAL_MS). */
const UPSTREAM_PROBE_EVERY = 3
/** Debounce window for reactive rebuilds so a burst of failures triggers one rebuild. */
const REBUILD_DEBOUNCE_MS = 60

function normalizeHostname(rawHost: string): string {
  const host = rawHost.trim().toLowerCase()
  // Strip IPv6 brackets so "[::1]" and "::1" compare equal.
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

export function shouldBypass(rawHost: string, noProxy: readonly string[]): boolean {
  const host = normalizeHostname(rawHost)
  if (!host) return false
  for (const rawEntry of noProxy) {
    const entry = rawEntry.trim().toLowerCase()
    if (!entry) continue
    if (entry === '*') return true
    if (entry.startsWith('.')) {
      // Suffix match: ".lan" covers "nas.lan" but not "lan" itself.
      if (host.endsWith(entry)) return true
      continue
    }
    if (host === normalizeHostname(entry)) return true
  }
  return false
}

/** Compose the http proxy URL from the configured host and port. */
export function proxyUrlOf(config: ProxyConfig): string {
  const host = (config.host ?? '127.0.0.1').trim()
  const port = config.port ?? 7890
  if (!host) throw new Error('dsh-proxy: host is empty')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`dsh-proxy: port ${JSON.stringify(port)} is not a valid TCP port`)
  }
  // Bracket IPv6 literals so the URL parses correctly.
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${authority}:${port}`
}

/** Host as `net.connect` expects it: IPv6 brackets stripped. */
function connectHost(config: ProxyConfig): string {
  const host = (config.host ?? '127.0.0.1').trim()
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/**
 * Liveness probe: can we open a TCP connection to the proxy's host:port?
 * True means the proxy port is listening (the proxy process is up); false
 * means it is not (e.g. Clash/mihomo not started), so DSH should go direct.
 */
function probeProxy(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const socket = connect({ host, port })
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      socket.destroy()
      resolve(ok)
    }
    timer = setTimeout(() => done(false), timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** True when the error means the transport/connection itself failed (as opposed to a clean HTTP response). */
function isTransportError(error: any): boolean {
  if (!error) return false
  const direct = error?.code
  const cause = error?.cause?.code
  if (typeof direct === 'string' && /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_CLOSED|UND_ERR_DESTROYED)$/.test(direct)) return true
  if (typeof cause === 'string' && /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_CLOSED|UND_ERR_DESTROYED)$/.test(cause)) return true
  const message = String(error?.message ?? error?.cause?.message ?? '')
  return /ECONNRESET|ECONNREFUSED|socket hang up|other side closed|fetch failed|connect ETIMEDOUT/i.test(message)
}

/**
 * Copy a DispatchHandler and intercept onError to report transport failures.
 * Uses prototype delegation so every other handler method forwards untouched.
 */
function wrapHandler(
  handler: Dispatcher.DispatchHandler,
  onTransportError: (error: any) => void,
): Dispatcher.DispatchHandler {
  if (!handler || typeof handler !== 'object') return handler
  if (typeof handler.onError !== 'function') return handler
  const wrapped: any = Object.create(handler)
  const original: any = handler.onError
  wrapped.onError = function (error: any) {
    try {
      if (isTransportError(error)) onTransportError(error)
    } catch {
      /* never let the hook break dispatch */
    }
    return original.call(handler, error)
  }
  return wrapped
}

/**
 * Dispatcher that sends bypass-listed hosts straight out and everything else
 * through the proxy. Both agents use Node's default TLS negotiation (no forced
 * version). The two agents are created lazily and owned by this instance's
 * close()/destroy().
 */
class RoutedDispatcher extends Dispatcher {
  private readonly direct: Agent
  private readonly proxied: ProxyAgent
  private readonly useProxy: boolean
  private readonly onTransportError: (error: any) => void

  constructor(
    proxyUrl: string,
    private readonly noProxy: readonly string[],
    useProxy: boolean,
    onTransportError: (error: any) => void,
  ) {
    super()
    this.useProxy = useProxy
    this.onTransportError = onTransportError
    this.direct = new Agent()
    this.proxied = new ProxyAgent({ uri: proxyUrl })
  }

  dispatch(
    opts: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): boolean {
    const wrapped = wrapHandler(handler, this.onTransportError)
    const origin = typeof opts.origin === 'string' ? opts.origin : opts.origin?.toString()
    let host = ''
    try {
      host = origin ? new URL(origin).hostname : ''
    } catch {
      host = ''
    }
    if (!this.useProxy || (host && shouldBypass(host, this.noProxy))) {
      return this.direct.dispatch(opts, wrapped)
    }
    return this.proxied.dispatch(opts, wrapped)
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.direct.close(), this.proxied.close()])
  }

  async destroy(): Promise<void> {
    await Promise.allSettled([this.direct.destroy(), this.proxied.destroy()])
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }
}

export function apply(ctx: Context, config: ProxyConfig) {
  const logger = ctx.logger(name)

  // Snapshot the dispatcher that was global when the plugin loaded. Restoring
  // it on dispose keeps unload symmetric even if other code chained its own
  // dispatcher on top of ours in between.
  const previous = getGlobalDispatcher()
  let installed: RoutedDispatcher | undefined
  let current = () => config
  /** Whether the configured proxy port is currently reachable. */
  let alive = false
  let probing = false
  let disposed = false
  let timer: ReturnType<typeof setInterval> | undefined
  let resetTimer: ReturnType<typeof setInterval> | undefined
  let resetPending = false
  let probeCounter = 0
  const isAutoReset = () => current().autoReset !== false

  const uninstall = (reason: string) => {
    if (installed === undefined) return
    const active = installed
    installed = undefined
    setGlobalDispatcher(previous)
    active.close().catch((error) => logger.warn('closing dispatcher failed:', error))
    logger.info(`custom proxy disabled (${reason}); restored the previous global dispatcher`)
  }

  const buildDispatcher = (rawConfig: ProxyConfig, useProxy: boolean): RoutedDispatcher => {
    const proxyUrl = proxyUrlOf(rawConfig)
    const noProxy = rawConfig.noProxy ?? DEFAULT_NO_PROXY
    return new RoutedDispatcher(proxyUrl, noProxy, useProxy, onTransportError)
  }

  const install = (rawConfig: ProxyConfig, useProxy: boolean) => {
    if (rawConfig.enabled === false) {
      uninstall('enabled = false')
      return
    }
    if (installed !== undefined) {
      // Config changed while active: swap atomically so in-flight requests
      // keep their dispatcher while new ones pick up the new settings.
      uninstall('reconfiguring')
    }
    installed = buildDispatcher(rawConfig, useProxy)
    setGlobalDispatcher(installed)
    logger.info(`${useProxy ? 'custom proxy active: host-side fetch traffic routes via' : 'custom proxy direct: host-side fetch traffic goes direct'}` +
      `${useProxy ? ' ' + proxyUrlOf(rawConfig) : ''}` +
      ((rawConfig.noProxy?.length as number) > 0 ? ` (bypass: ${(rawConfig.noProxy as string[]).join(', ')})` : ''))
  }

  const installDirect = (rawConfig: ProxyConfig) => install(rawConfig, false)

  /**
   * Swap the global dispatcher to a brand-new RoutedDispatcher and retire the
   * old one. Forceful destroys pooled sockets immediately (used after a
   * transport failure); graceful closes only idle sockets so in-flight
   * streaming responses are left alone (used by the periodic reset).
   */
  const rebuild = (reason: string, forceful: boolean) => {
    if (disposed || installed === undefined) return
    const cfg = current()
    if (cfg.enabled === false) return
    const useProxy = alive
    const old = installed
    const fresh = buildDispatcher(cfg, useProxy)
    installed = fresh
    setGlobalDispatcher(fresh)
    const retire = forceful ? old.destroy() : old.close()
    retire.catch((error) => logger.warn('retiring old dispatcher failed:', error))
    logger.info(`connection pool rebuilt (${reason}${forceful ? ', forceful' : ''})`)
  }

  /** Debounced reactive reset: a burst of transport failures triggers one rebuild. */
  const scheduleRebuild = (error: any) => {
    if (!isAutoReset() || disposed || installed === undefined) return
    if (resetPending) return
    resetPending = true
    setTimeout(() => {
      resetPending = false
      rebuild(`transport error: ${error?.code ?? error?.message ?? 'unknown'}`, true)
    }, REBUILD_DEBOUNCE_MS)
  }

  const onTransportError = (error: any) => {
    scheduleRebuild(error)
  }

  /**
   * Real HTTP probe through a throwaway ProxyAgent: does the tunnel reach the
   * internet? Any HTTP response (2xx/4xx/5xx) proves the bytes flowed.
   */
  const probeUpstream = async (cfg: ProxyConfig): Promise<boolean> => {
    const agent = new ProxyAgent({ uri: proxyUrlOf(cfg) })
    try {
      const response = await fetch(cfg.probeUrl ?? DEFAULT_PROBE_URL, {
        method: 'GET',
        dispatcher: agent,
        redirect: 'manual',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      } as RequestInit)
      const body: any = response?.body
      if (body && typeof body.cancel === 'function') body.cancel().catch(() => { })
      return true
    } catch {
      return false
    } finally {
      agent.close().catch(() => { })
    }
  }

  const probe = async () => {
    if (probing || disposed) return
    probing = true
    try {
      const cfg = current()
      if (cfg.enabled === false) {
        if (alive) {
          alive = false
          uninstall('enabled = false')
        }
        return
      }
      const host = connectHost(cfg)
      const port = cfg.port ?? 7890
      const ok = await probeProxy(host, port, PROBE_TIMEOUT_MS)
      if (ok !== alive) {
        alive = ok
        logger.info(ok
          ? `dsh-proxy: proxy reachable at ${host}:${port} — routing through it`
          : `dsh-proxy: proxy unreachable at ${host}:${port} — falling back to direct`)
        if (ok) install(cfg, true)
        else installDirect(cfg)
      } else if (installed === undefined) {
        if (ok) install(cfg, true)
        else installDirect(cfg)
      }
      // Upstream probe (every N-th cycle), only while routed through the proxy.
      if (alive && isAutoReset() && installed !== undefined) {
        probeCounter += 1
        if (probeCounter % UPSTREAM_PROBE_EVERY === 0) {
          const up = await probeUpstream(cfg)
          if (!up) {
            logger.warn('dsh-proxy: upstream probe failed — rebuilding connection pool')
            rebuild('upstream probe failed', true)
          }
        }
      }
    } catch (error) {
      logger.warn('dsh-proxy: proxy probe failed:', error)
      if (alive) {
        alive = false
        installDirect(current())
      }
    } finally {
      probing = false
    }
  }

  // Start direct (no proxy interception of the TLS path) so a restart while the
  // proxy is down never strands the process; the probe flips to proxy once the
  // port answers. With enabled=false this is a no-op and nothing is installed.
  installDirect(current())
  void probe()
  timer = setInterval(() => void probe(), PROBE_INTERVAL_MS)
  if (RESET_INTERVAL_MS > 0) {
    resetTimer = setInterval(() => {
      if (isAutoReset() && installed !== undefined && current().enabled !== false) {
        rebuild('periodic reset', false)
      }
    }, RESET_INTERVAL_MS)
  }

  // Register the settings namespace so a configuration surface can edit this
  // section live. Runs only while a settings service is present.
  ctx.inject(['settings'], (sctx) => {
    (sctx.settings as SettingsProvider).installSection(ctx, NS, Config, config as any, {
      setSource: (source: () => ProxyConfig) => {
        current = source
      },
      onChange: () => {
        try {
          // host/port/enabled/autoReset/probeUrl may have changed:
          // drop to direct, then re-probe immediately against the new settings.
          alive = false
          installDirect(current())
          void probe()
        } catch (error) {
          logger.error('dsh-proxy: keeping the previous dispatcher after a refused update')
          logger.error(error)
        }
      },
    })
  })

  const events = ctx as unknown as {
    on?: (event: string, listener: (...args: never[]) => void) => void
  }
  events.on?.('dispose', () => {
    disposed = true
    if (timer !== undefined) clearInterval(timer)
    if (resetTimer !== undefined) clearInterval(resetTimer)
    uninstall('plugin unloaded')
  })
}

export default { name, inject, Config, apply }
