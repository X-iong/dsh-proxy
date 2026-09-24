import * as React from 'react'
import {
  SettingsForm,
  SettingsFormModel,
  SettingsValueField,
  settingsNumberField,
  settingsTextField,
  type SettingsFieldSpec,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormScope,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * The plugin's browser half.
 *
 * Where the card lives in this harness: the sidebar **Plugins** panel lists the
 * profile's bundles, and the `dsh-proxy` bundle's own row gains a configure
 * control that opens this card. The seat is the Plugins page's
 * `plugins.row.config` slot, keyed `<bundle package name>#<row id>` — registering
 * into `plugins.item` is reserved for the official host-plane plugins, so a
 * third-party bundle belongs here.
 *
 * How the card reads and writes configuration: the namespace IS this plugin's
 * Loader entry id, and `ctx.configForms.get(id)` is the shared, revision-fenced
 * form over it. `SettingsFormModel` stages the user's edits and writes them only
 * on save; the Host stays the authority on what it accepted, so the form re-seeds
 * from the accepted section instead of predicting the outcome.
 *
 * This half requires no extra module: `react` and
 * `@deepseek-ai/dsh-client-ui-primitives` are both part of the client module
 * table's baseline seed, so the bundle requires them by specifier and needs no
 * `dsh.client.external` entry.
 */

/** npm package name — half of the `plugins.row.config` registration key. */
const PKG = 'dsh-proxy'

/**
 * The Loader row id the bundle patch declares. It is ALSO this entry's settings
 * namespace (the Host keys config forms by entry id) and the key half the card
 * registers under, so the three can never disagree. A composition that mounts
 * the plugin under another id gets no card; the host half logs that case.
 */
const NS = 'dsh-proxy'

/** Locale namespace owning this card's copy. */
const LOCALE_NS = 'dshProxy'

/** How often to re-read the host half's read-only runtime status. */
const STATUS_POLL_MS = 3000

/** The status route the host half registers (loopback-only, no secrets). */
const STATUS_PATH = '/dsh-proxy/status'

/** Simplified Chinese copy. */
const zh = {
  description: '自定义 HTTP 代理：让 DSH 宿主进程的全部 fetch（LLM 请求、模型发现、市场、web 搜索）经代理出站。',
  enabled: '启用代理',
  host: '代理地址',
  hostHint: '代理服务器地址，例如 127.0.0.1',
  port: '端口',
  portHint: '例如 7890',
  overridden: '已覆盖',
  reset: '恢复默认',
  invalidHost: '无效地址',
  invalidPort: '无效端口',
  unavailable: '该插件当前未加载，暂时无法配置。',
  readOnly: '本部署的设置为只读。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  statusUnreadable: '宿主状态：暂不可读',
  routing: '路由：{state}',
  routingProxy: '走代理',
  routingDirect: '直连（代理端口不可达）',
  routingDisabled: '未启用',
  routingStarting: '正在判定…',
  routingUnknown: '未知',
  tunnelOk: '隧道：正常',
  tunnelBroken: '隧道异常：代理节点不可达（{at} 起）。请切换节点，或关闭代理改走直连。',
}

/** English copy. */
const en = {
  description: 'Custom HTTP proxy: routes every host-side fetch (LLM requests, model discovery, market, web search) through your proxy.',
  enabled: 'Enable proxy',
  host: 'Proxy host',
  hostHint: 'Proxy server address, for example 127.0.0.1',
  port: 'Port',
  portHint: 'For example 7890',
  overridden: 'Overridden',
  reset: 'Reset to default',
  invalidHost: 'Not a valid address',
  invalidPort: 'Not a valid port',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  readOnly: 'This deployment stores settings read-only.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  statusUnreadable: 'Host status: not readable right now',
  routing: 'Routing: {state}',
  routingProxy: 'through the proxy',
  routingDirect: 'direct (proxy port unreachable)',
  routingDisabled: 'not enabled',
  routingStarting: 'deciding…',
  routingUnknown: 'unknown',
  tunnelOk: 'Tunnel: healthy',
  tunnelBroken: 'Tunnel broken: the proxy node is unreachable (since {at}). Switch nodes, or turn the proxy off to go direct.',
}

/** Translate function bound to this card's locale namespace. */
type Translate = (key: string, params?: Record<string, unknown>) => string

/** The configuration section this card edits. */
interface ProxySection {
  enabled?: boolean
  host?: string
  port?: number
}

/**
 * A boolean field staged as the draft text `'true'` / `'false'`.
 *
 * The shared form model works in draft text so that what the user sees is
 * exactly what a save would store; a checkbox is just a control that only ever
 * stages one of these two strings.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value: unknown) => (value === true ? 'true' : 'false'),
    parse: (text: string) => (
      text === 'true' || text === 'false' ? { kind: 'set', value: text === 'true' } : undefined
    ),
  }
}

/** What the card's component reads. */
interface CardProjection extends SettingsFormShell {
  enabled: SettingsFieldState
  host: SettingsFieldState
  port: SettingsFieldState
}

/** A minimal snapshot store, as the shared form model binds one. */
interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/**
 * The form this card stages over the plugin's own Loader entry.
 *
 * One owner for the whole read/write path: the model reads the shared config
 * form, holds the drafts, and writes every staged edit in one revision-fenced
 * mutation on save.
 */
class ProxyCardController {
  private readonly form: SettingsFormModel<ProxySection>
  private readonly store: SnapshotStore<CardProjection>

  /** @param scope - the shared config form for this plugin's entry id. */
  constructor(scope: SettingsFormScope<ProxySection>) {
    this.form = new SettingsFormModel<ProxySection>(scope, [
      settingsBooleanField('enabled'),
      settingsTextField('host'),
      settingsNumberField('port'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): CardProjection {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      host: this.form.field('host'),
      port: this.form.field('port'),
    }
  }

  /**
   * The business face the slot registration injects: the snapshot the component
   * selects from, the form's edit/save actions, and the bound translate.
   * @param t - the card's bound translate function.
   * @returns the inject face.
   */
  inject(t: Translate) {
    return {
      hooks: { proxyCard: this.store },
      ...this.form.actions(),
      t,
    }
  }

  /** Release the accepted-value subscription. */
  dispose(): void {
    this.form.dispose()
  }
}

/** One host readout line; warning-toned when the tunnel is down. */
interface StatusLine {
  warn: boolean
  text: string
}

/** The host half's read-only runtime readout (see its `/dsh-proxy/status` route). */
interface RuntimeStatus {
  enabled?: boolean
  host?: string
  port?: number
  routing?: string
  tunnel?: string
  tunnelBrokenAt?: number | null
  upstreamFailures?: number
  probeUrl?: string
}

/**
 * Poll the host's status route.
 *
 * A broken tunnel changes no routing (the host half never abandons the tunnel on
 * its own), so this readout is how that verdict becomes visible without reading
 * the host log. A missing route simply leaves the lines generic.
 * @returns the last readable status, or undefined while none is readable.
 */
function useRuntimeStatus(): RuntimeStatus | undefined {
  const [status, setStatus] = React.useState<RuntimeStatus | undefined>(undefined)
  React.useEffect(() => {
    let live = true
    const read = async () => {
      try {
        const response = await fetch(STATUS_PATH, { cache: 'no-store' })
        if (!live) return
        setStatus(response.ok ? (await response.json()) as RuntimeStatus : undefined)
      } catch {
        if (live) setStatus(undefined)
      }
    }
    void read()
    const id = setInterval(() => { void read() }, STATUS_POLL_MS)
    return () => { live = false; clearInterval(id) }
  }, [])
  return status
}

/**
 * One line per fact, warning-toned when the tunnel is down.
 * @param status - the last readable host status.
 * @param t - the card's bound translate.
 * @returns the lines to render, in order.
 */
function statusLines(status: RuntimeStatus | undefined, t: Translate): StatusLine[] {
  if (status === undefined) return [{ warn: false, text: t('statusUnreadable') }]
  const routing = String(status.routing ?? '')
  const routingText = routing === 'proxy' ? t('routingProxy')
    : routing === 'direct' ? t('routingDirect')
      : routing === 'disabled' ? t('routingDisabled')
        : routing === 'starting' ? t('routingStarting')
          : t('routingUnknown')
  const lines: StatusLine[] = [{ warn: false, text: t('routing', { state: routingText }) }]
  if (status.tunnel === 'broken') {
    const at = typeof status.tunnelBrokenAt === 'number'
      ? new Date(status.tunnelBrokenAt).toLocaleTimeString()
      : t('routingStarting')
    lines.push({ warn: true, text: t('tunnelBroken', { at }) })
  } else {
    lines.push({ warn: false, text: t('tunnelOk') })
  }
  return lines
}

/** Inline styling for the readout; the primitives own the form chrome itself. */
const STATUS_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}
const STATUS_WARN_STYLE: React.CSSProperties = { ...STATUS_STYLE, color: 'var(--dsw-alias-label-error)' }
const TOGGLE_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 0',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
}

/** Props a `plugins.row.config` entry receives, plus this card's inject face. */
interface ProxyCardProps {
  /** `summary` renders the row's one-liner; `page` renders the form. */
  view: 'summary' | 'page'
  useProxyCard: <T>(selector: (snapshot: CardProjection) => T) => T
  edit: SettingsFormActions['edit']
  resetField: SettingsFormActions['resetField']
  save: SettingsFormActions['save']
  discard: SettingsFormActions['discard']
  t: Translate
}

/**
 * The dsh-proxy configuration card.
 *
 * The Plugins page draws the page chrome (title, crumb, expand/collapse), so
 * this component owns only the body: the host's read-only status verdict, the
 * three editable fields, and the save. Leaving the page drops the drafts — the
 * shared form frame discards on unmount and offers no separate discard control.
 * @param props - the requested view, the inject face, and the bound translate.
 * @returns the row's one-liner, or the form body.
 */
function ProxyCard(props: ProxyCardProps) {
  const { t } = props
  const state = props.useProxyCard((snapshot) => snapshot)
  const status = useRuntimeStatus()

  if (props.view === 'summary') return t('description')

  const disabled = !state.writable
  // `children` rides the props object rather than createElement's third
  // argument: SettingsFormProps declares it required, and React's typings only
  // accept the third-argument form for a component whose props make it optional.
  return React.createElement(SettingsForm, {
    labels: {
      unavailable: t('unavailable'),
      readOnly: t('readOnly'),
      saveFailed: t('saveFailed'),
      save: t('save'),
      saving: t('saving'),
    },
    state,
    onSave: props.save,
    onDiscard: props.discard,
    children: [
      React.createElement(
        'div',
        { key: 'status' },
        statusLines(status, t).map((line, index) =>
          React.createElement('p', {
            key: index,
            style: line.warn ? STATUS_WARN_STYLE : STATUS_STYLE,
          }, line.text),
        ),
      ),
      React.createElement('label', { key: 'enabled', style: TOGGLE_STYLE }, [
        React.createElement('input', {
          key: 'box',
          type: 'checkbox',
          checked: state.enabled.text === 'true',
          disabled,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            props.edit('enabled', event.target.checked ? 'true' : 'false')
          },
        }),
        t('enabled'),
      ]),
      React.createElement(SettingsValueField, {
        key: 'host',
        id: 'dsh-proxy-host',
        label: t('host'),
        hint: t('hostHint'),
        invalidLabel: t('invalidHost'),
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        disabled,
        text: state.host.text,
        overridden: state.host.overridden,
        invalid: state.host.invalid,
        onEdit: (text: string) => { props.edit('host', text) },
        onReset: () => { props.resetField('host') },
      }),
      React.createElement(SettingsValueField, {
        key: 'port',
        id: 'dsh-proxy-port',
        label: t('port'),
        hint: t('portHint'),
        invalidLabel: t('invalidPort'),
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        disabled,
        numeric: true,
        text: state.port.text,
        overridden: state.port.overridden,
        invalid: state.port.invalid,
        onEdit: (text: string) => { props.edit('port', text) },
        onReset: () => { props.resetField('port') },
      }),
    ],
  })
}

/** The shared config form for one namespace, as `ctx.configForms.get(id)` returns it. */
type ConfigFormLike<T> = SettingsFormScope<T>

/** The slot registry members this half calls. */
interface SlotsService {
  /**
   * Install an effect for each declaration lifetime of a slot: the callback runs
   * as soon as the slot is declared, or immediately when it already is.
   */
  inject(key: string, callback: () => () => void): () => void
  /** Contribute a component to a declared slot. */
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** The settings forms service members this half calls. */
interface ConfigFormsService {
  /** Get the shared form for one Host plugin entry id. */
  get<T>(entryId: string): ConfigFormLike<T>
  /** Keep a registration alive while the Host serves any of some namespaces. */
  whileServed(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void): () => void
}

/** The locale service members this half calls. */
interface LocaleService {
  /** Register one namespace's dictionary for one locale. */
  register(ns: string, locale: string, dict: Record<string, string>): () => void
  /** Bind a namespace to a translate function reading the active locale at call time. */
  bind(ns: string): Translate
}

/**
 * The client services this browser half uses.
 *
 * Declared structurally with the official contracts as the source of truth —
 * `slots` is the renderer's `SlotRegistry`, `configForms` is the settings
 * domain's `ConfigForms`, `locale` is `LocaleRuntime` — naming only the members
 * this half calls, so the plugin keeps no type dependency on packages it does
 * not ship with.
 */
interface ClientContext {
  slots: SlotsService
  configForms: ConfigFormsService
  locale: LocaleService
  /** Run a disposer-returning effect on this plugin's fiber. */
  effect(callback: () => unknown, label?: string): unknown
}

export const name = 'dsh-proxy-client'

/**
 * Required services (cordis fiber inject).
 *
 * Note that this is the CLIENT half's own declaration, separate from
 * `package.json.dsh.client.inject` — that field is an informational list of
 * package-name edges for the boot graph and carries no service meaning.
 */
export const inject = ['slots', 'configForms', 'locale']

/**
 * Mount the configuration card.
 *
 * Registration is gated twice, deliberately: `whileServed` keeps the card absent
 * until the Host actually serves this plugin's entry (so a deployment that never
 * mounted it shows no trace), and `slots.inject` keeps it absent until the
 * Plugins page declares the slot (registering into an undeclared slot throws).
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(LOCALE_NS)
  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'zh', zh), 'dsh-proxy: Chinese dictionary')
  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'en', en), 'dsh-proxy: English dictionary')

  const card = new ProxyCardController(ctx.configForms.get<ProxySection>(NS))
  ctx.effect(() => () => { card.dispose() }, 'dsh-proxy: settings form subscription')

  ctx.effect(
    () => ctx.configForms.whileServed([NS], () => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
      name: 'plugins.row.config',
      key: `${PKG}#${NS}`,
      inject: () => card.inject(t),
    }, ProxyCard))),
    'dsh-proxy: configuration card',
  )
}

export default { name, inject, apply }
