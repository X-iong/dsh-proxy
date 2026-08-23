import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  Agent,
  Dispatcher,
  ProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici'

export const name = 'dsh-proxy'
export const inject = { settings: { required: false } }

/** Settings namespace this plugin owns; the browser card pairs with it. */
export const NS = settingsNamespace('dsh-proxy')

export interface ProxyConfig {
  enabled?: boolean
  host?: string
  port?: number
  noProxy?: string[]
}

export const Config = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('启用自定义代理。关闭后恢复 DSH 宿主进程原来的直连方式。'),
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
})

const DEFAULT_NO_PROXY = ['localhost', '127.0.0.1', '::1', '[::1]']

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

export function apply(ctx: Context, config: ProxyConfig) {
  const logger = ctx.logger(name)

  // Snapshot the dispatcher that was global when the plugin loaded. Restoring
  // it on dispose keeps unload symmetric even if other code chained its own
  // dispatcher on top of ours in between.
  const previous = getGlobalDispatcher()
  let installed: RoutedDispatcher | undefined
  let current = () => config

  const uninstall = (reason: string) => {
    if (installed === undefined) return
    const active = installed
    installed = undefined
    setGlobalDispatcher(previous)
    active.close().catch((error) => logger.warn('closing proxy dispatcher failed:', error))
    logger.info(`custom proxy disabled (${reason}); restored the previous global dispatcher`)
  }

  const install = (rawConfig: ProxyConfig) => {
    if (rawConfig.enabled === false) {
      uninstall('enabled = false')
      return
    }
    const proxyUrl = proxyUrlOf(rawConfig)
    const noProxy = rawConfig.noProxy ?? DEFAULT_NO_PROXY
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

  install(current())

  // Register the settings namespace so the browser card in
  // Settings → Plugins → 插件配置 can edit this section live; every accepted
  // write re-runs install() with the freshly resolved config, no restart.
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source: () => ProxyConfig) => {
      current = source
    },
    onChange: () => {
      try {
        install(current())
      } catch (error) {
        logger.error('dsh-proxy: keeping the previous dispatcher after a refused update')
        logger.error(error)
      }
    },
  })

  const events = ctx as unknown as {
    on?: (event: string, listener: (...args: never[]) => void) => void
  }
  events.on?.('dispose', () => uninstall('plugin unloaded'))
}

export default { name, inject, Config, apply }
