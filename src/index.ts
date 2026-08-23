import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import {
  Agent,
  Dispatcher,
  ProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici'

export const name = 'dsh-proxy'
export const inject = { settings: { required: false } }

export interface ProxyConfig {
  enabled?: boolean
  proxyUrl?: string
  noProxy?: string[]
}

export const Config = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('启用自定义代理。关闭后恢复 DSH 宿主进程原来的直连方式。'),
  proxyUrl: Schema.string()
    .role('url')
    .default('http://127.0.0.1:7890')
    .description('HTTP 代理地址，例如 Clash/mihomo 的混合端口 http://127.0.0.1:7890。仅支持 http/https 代理。'),
  noProxy: Schema.array(String)
    .default(['localhost', '127.0.0.1', '::1', '[::1]'])
    .description('绕过代理的主机名单：精确匹配主机名，或以 . 开头匹配域名后缀（如 .lan）。'),
})

const SUPPORTED_PROXY_PROTOCOLS = new Set(['http:', 'https:'])

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

/**
 * Dispatcher that sends bypass-listed hosts straight out and everything else
 * through the proxy. Both agents are created lazily and owned by this
 * instance's close().
 */
class RoutedDispatcher extends Dispatcher {
  private readonly direct: Agent
  private readonly proxied: ProxyAgent

  constructor(proxyUrl: string, private readonly noProxy: readonly string[]) {
    super()
    this.direct = new Agent()
    this.proxied = new ProxyAgent(proxyUrl)
  }

  dispatch(
    opts: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): boolean {
    const origin = typeof opts.origin === 'string' ? opts.origin : opts.origin?.toString()
    let host = ''
    try {
      host = origin ? new URL(origin).hostname : ''
    } catch {
      host = ''
    }
    if (host && shouldBypass(host, this.noProxy)) {
      return this.direct.dispatch(opts, handler)
    }
    return this.proxied.dispatch(opts, handler)
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

function assertSupportedProxyUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('dsh-proxy: proxyUrl is empty')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(`dsh-proxy: proxyUrl ${JSON.stringify(trimmed)} is not a valid URL`)
  }
  if (!SUPPORTED_PROXY_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      `dsh-proxy: unsupported proxy protocol ${JSON.stringify(url.protocol)}; ` +
        'SOCKS and PAC URLs are not supported — use an http:// or https:// proxy URL ' +
        '(Clash/mihomo expose one on their mixed port, e.g. http://127.0.0.1:7890)',
    )
  }
  return trimmed
}

export function apply(ctx: Context, config: ProxyConfig) {
  const logger = ctx.logger(name)

  // Snapshot the dispatcher that was global when the plugin loaded. Restoring
  // it on dispose keeps unload symmetric even if other code chained its own
  // dispatcher on top of ours in between.
  const previous = getGlobalDispatcher()
  let installed: RoutedDispatcher | undefined

  const uninstall = (reason: string) => {
    if (installed === undefined) return
    const current = installed
    installed = undefined
    setGlobalDispatcher(previous)
    current.close().catch((error) => logger.warn('closing proxy dispatcher failed:', error))
    logger.info(`custom proxy disabled (${reason}); restored the previous global dispatcher`)
  }

  const install = (rawConfig: ProxyConfig) => {
    if (rawConfig.enabled === false) {
      uninstall('enabled = false')
      return
    }
    const proxyUrl = assertSupportedProxyUrl(rawConfig.proxyUrl ?? 'http://127.0.0.1:7890')
    const noProxy = rawConfig.noProxy ?? ['localhost', '127.0.0.1', '::1', '[::1]']
    if (installed !== undefined) {
      // Config changed while active: swap atomically so in-flight requests
      // keep their dispatcher while new ones pick up the new settings.
      uninstall('reconfiguring')
    }
    installed = new RoutedDispatcher(proxyUrl, noProxy)
    setGlobalDispatcher(installed)
    logger.info(
      `custom proxy active: all host-side fetch traffic routes via ${proxyUrl}` +
        (noProxy.length > 0 ? ` (bypass: ${noProxy.join(', ')})` : ''),
    )
  }

  install(config)

  // Re-apply on every settings write; the settings seam hands us the freshly
  // resolved config, so a user edit in Settings takes effect without restart.
  const events = ctx as unknown as {
    on?: (event: string, listener: (...args: never[]) => void) => void
  }
  events.on?.('config', (next: ProxyConfig) => install(next))
  events.on?.('dispose', () => uninstall('plugin unloaded'))
}

export default { name, inject, Config, apply }
