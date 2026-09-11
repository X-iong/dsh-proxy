import * as React from 'react'

/**
 * Minimal snapshot store used by the card: the runtime's `createSnapshotStore`
 * is small enough to keep local so the bundle has no extra module dependency.
 */
function createSnapshotStore<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    set: (next: T) => { value = next; for (const fn of listeners) fn(); },
  }
}

const { createElement: h } = React

/** Settings namespace shared with the host half. */
const NS = 'dsh-proxy'

const CSS_TAG = 'dsh-proxy/ProxyCard.module.css'
const CSS = `
.dsh-proxy-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary)}
.dsh-proxy-card h3{margin:0;font-size:14px;font-weight:600}
.dsh-proxy-card .desc{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsh-proxy-field{display:flex;flex-direction:column;gap:4px}
.dsh-proxy-field label{font-size:12px;font-weight:500}
.dsh-proxy-field input{font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-background-primary);color:inherit}
.dsh-proxy-field input[data-invalid=true]{border-color:var(--dsw-alias-state-danger,#d33)}
.dsh-proxy-field .hint{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsh-proxy-row{display:flex;gap:10px;align-items:flex-start}
.dsh-proxy-row .grow{flex:1}
.dsh-proxy-toggle{display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer}
.dsh-proxy-actions{display:flex;gap:8px;justify-content:flex-end;align-items:center}
.dsh-proxy-actions button{font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-background-primary);color:inherit;cursor:pointer}
.dsh-proxy-actions button[data-primary=true]{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}
.dsh-proxy-actions button:disabled{opacity:.5;cursor:default}
.dsh-proxy-status{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-right:auto}
.dsh-proxy-trigger{display:flex;align-items:center;gap:6px;font:inherit;font-size:13px;padding:6px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-background-primary);color:inherit;cursor:pointer;line-height:1}
.dsh-proxy-trigger:hover{background:var(--dsw-alias-background-secondary,#00000014)}
.dsh-proxy-trigger[data-active=true]{border-color:var(--dsw-alias-state-business-primary)}
.dsh-proxy-trigger-icon{font-size:14px;line-height:1}
.dsh-proxy-overlay{position:fixed;left:16px;bottom:64px;z-index:1000;pointer-events:auto;width:340px;max-width:calc(100vw - 32px)}
.dsh-proxy-overlay-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid var(--dsw-alias-border-l2);border-bottom:none;border-radius:8px 8px 0 0;background:var(--dsw-alias-background-primary)}
.dsh-proxy-overlay-header .t{margin:0;font-size:13px;font-weight:600}
.dsh-proxy-overlay-header button{font:inherit;font-size:12px;padding:3px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.dsh-proxy-overlay .dsh-proxy-card{border-radius:0 0 8px 8px;max-width:none}
`

function ensureCss(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-proxy'
  tag.dataset.pluginCss = CSS_TAG
  tag.textContent = CSS
  document.head.appendChild(tag)
}

type Write = { kind: 'set'; value: unknown } | { kind: 'clear' }

interface FieldSpec {
  field: string
  format: (value: any) => any
  parse: (input: any) => Write | undefined
}

/** A whole-number field; empty draft clears, non-numeric blocks save. */
function numberField(field: string): FieldSpec {
  return {
    field,
    format: (value: any) => (typeof value === 'number' ? String(value) : ''),
    parse: (text: any) => {
      const trimmed = String(text).trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/** A free-text field; empty draft clears. */
function textField(field: string): FieldSpec {
  return {
    field,
    format: (value: any) => (typeof value === 'string' ? value : ''),
    parse: (text: any) => {
      const trimmed = String(text).trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/** A boolean field rendered as a checkbox; drafts are real booleans. */
function booleanField(field: string): FieldSpec {
  return {
    field,
    format: (value: any) => Boolean(value),
    parse: (value: any) => ({ kind: 'set', value: Boolean(value) }),
  }
}

interface ScopeSnapshot {
  status: string
  value?: Record<string, any>
  base?: Record<string, any>
  user?: Record<string, any>
  writable?: boolean
}

interface SettingsScope {
  getSnapshot(): ScopeSnapshot
  subscribe(listener: () => void): unknown
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

interface FieldState {
  value: any
  overridden: boolean
  invalid: boolean
}

interface CardShell {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
}

interface CardProjection extends CardShell {
  enabled: FieldState
  host: FieldState
  port: FieldState
}

interface SnapshotStore<T> {
  set(value: T): void
}

/**
 * Staged form over the dsh-proxy settings namespace. Mirrors the CardForm
 * pattern from the built-in settings-plugins package: drafts are staged
 * locally and written only on save, each write fenced by the namespace
 * revision.
 */
class ProxyCardController {
  private readonly scope: SettingsScope
  private readonly specs: Map<string, FieldSpec>
  private readonly staged = new Map<string, { value: any }>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false

  constructor(scope: SettingsScope) {
    this.scope = scope
    this.specs = new Map<string, FieldSpec>([
      ['enabled', booleanField('enabled')],
      ['host', textField('host')],
      ['port', numberField('port')],
    ])
    scope.subscribe(() => this.publish())
  }

  bind<T>(project: () => T): SnapshotStore<T> {
    const store = createSnapshotStore(project()) as SnapshotStore<T>
    this.listeners.add(() => store.set(project()))
    return store
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }

  private sectionValue(field: string): any {
    const snapshot = this.scope.getSnapshot()
    const section = snapshot.status === 'ready' ? snapshot.value : undefined
    return section?.[field]
  }

  private baseValue(field: string): any {
    const snapshot = this.scope.getSnapshot()
    const base = snapshot.status === 'ready' ? snapshot.base : undefined
    return base?.[field]
  }

  private stored(field: string): boolean {
    const snapshot = this.scope.getSnapshot()
    const user = snapshot.status === 'ready' ? snapshot.user : undefined
    return user !== undefined && Object.prototype.hasOwnProperty.call(user, field)
  }

  private shell(): CardShell {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.status === 'ready' && snapshot.writable !== false,
      dirty: plan.length > 0,
      invalid: plan.some((item) => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  private field(field: string): FieldState {
    const spec = this.specs.get(field)!
    const staged = this.staged.get(field)
    if (staged === undefined) {
      return { value: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    const write = spec.parse(staged.value)
    return { value: staged.value, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  private plan(): Array<{ field: string; run: Write | undefined }> {
    const items: Array<{ field: string; run: Write | undefined }> = []
    for (const [field, staged] of this.staged) {
      const spec = this.specs.get(field)!
      items.push({ field, run: spec.parse(staged.value) })
    }
    return items
  }

  actions() {
    return {
      edit: (field: string, value: any) => {
        this.staged.set(field, { value })
        this.publish()
      },
      resetField: (field: string) => {
        this.staged.set(field, { value: this.specs.get(field)!.format(this.baseValue(field)) })
        this.publish()
      },
      save: () => {
        void this.save()
      },
      discard: () => {
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  private async save(): Promise<void> {
    if (this.saving) return
    const plan = this.plan()
    if (plan.some((item) => item.run === undefined)) return
    this.saving = true
    this.failed = false
    this.publish()
    try {
      for (const item of plan) {
        if (item.run!.kind === 'clear') await this.scope.unset(item.field)
        else await this.scope.set(item.field, item.run!.value)
      }
      this.staged.clear()
    } catch {
      this.failed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }

  inject() {
    return { hooks: { proxyCard: this.bind(() => this.projection()) }, ...this.actions() }
  }

  private projection(): CardProjection {
    return {
      ...this.shell(),
      enabled: this.field('enabled'),
      host: this.field('host'),
      port: this.field('port'),
    }
  }
}

interface FieldProps {
  id: string
  label: string
  hint: string
  invalidLabel: string
  value: string
  invalid: boolean
  disabled: boolean
  placeholder?: string
  onEdit: (text: string) => void
}

function Field(props: FieldProps) {
  return h('div', { className: 'dsh-proxy-field' }, [
    h('label', { key: 'label', htmlFor: props.id }, props.label),
    h('input', {
      key: 'input',
      id: props.id,
      type: 'text',
      value: props.value,
      placeholder: props.placeholder ?? '',
      disabled: props.disabled,
      'data-invalid': props.invalid ? true : undefined,
      onChange: (event: any) => props.onEdit(event.target.value),
    }),
    h('p', { key: 'hint', className: 'hint' }, props.invalid ? props.invalidLabel : props.hint),
  ])
}

interface ProxyCardProps {
  useProxyCard: <T>(selector: (snapshot: CardProjection) => T) => T
  edit: (field: string, value: any) => void
  resetField: (field: string) => void
  save: () => void
  discard: () => void
}

function ProxyCard(props: ProxyCardProps) {
  ensureCss()
  const state = props.useProxyCard((snapshot) => snapshot)
  const disabled = !state.writable || state.saving
  return h('div', { className: 'dsh-proxy-card' }, [
    h('h3', { key: 'title' }, 'dsh-proxy'),
    h(
      'p',
      { key: 'desc', className: 'desc' },
      '自定义 HTTP 代理：让 DSH 宿主进程的全部 fetch（LLM 请求、模型发现、市场、web 搜索）经代理出站。保存后即时生效，无需重启。',
    ),
    h('label', { key: 'enabled', className: 'dsh-proxy-toggle' }, [
      h('input', {
        key: 'box',
        type: 'checkbox',
        checked: Boolean(state.enabled.value),
        disabled,
        onChange: (event: any) => props.edit('enabled', event.target.checked),
      }),
      '启用代理',
    ]),
    h('div', { key: 'fields', className: 'dsh-proxy-row' }, [
      h(
        'div',
        { key: 'host', className: 'grow' },
        h(Field, {
          id: 'dsh-proxy-host',
          label: '代理地址',
          hint: '代理服务器地址，例如 127.0.0.1',
          invalidLabel: '无效地址',
          value: state.host.value,
          invalid: state.host.invalid,
          disabled,
          onEdit: (text) => props.edit('host', text),
        }),
      ),
      h(
        'div',
        { key: 'port', style: { width: '120px' } },
        h(Field, {
          id: 'dsh-proxy-port',
          label: '端口',
          hint: '例如 7890',
          invalidLabel: '无效端口',
          value: state.port.value,
          invalid: state.port.invalid,
          disabled,
          onEdit: (text) => props.edit('port', text),
        }),
      ),
    ]),
    h('div', { key: 'actions', className: 'dsh-proxy-actions' }, [
      h(
        'span',
        { key: 'status', className: 'dsh-proxy-status' },
        state.failed ? '保存被拒绝，请检查值后重试' : state.dirty ? '有未保存的修改' : '',
      ),
      h(
        'button',
        { key: 'discard', type: 'button', disabled: !state.dirty || state.saving, onClick: props.discard },
        '放弃',
      ),
      h(
        'button',
        {
          key: 'save',
          type: 'button',
          'data-primary': true,
          disabled: !state.dirty || state.invalid || state.saving,
          onClick: props.save,
        },
        state.saving ? '保存中…' : '保存',
      ),
    ]),
  ])
}

/** Shared open/closed state for the footer trigger and the overlay panel. */
let openState = false
const openListeners = new Set<() => void>()
const openStore = {
  get: () => openState,
  set: (v: boolean) => {
    openState = v
    openListeners.forEach((l) => l())
  },
  subscribe: (l: () => void) => {
    openListeners.add(l)
    return () => {
      openListeners.delete(l)
    }
  },
}

function useOpen(): boolean {
  const [, force] = React.useState(0)
  React.useEffect(() => openStore.subscribe(() => force((x) => x + 1)), [])
  return openStore.get()
}

interface FooterTriggerProps {
  wide?: boolean
}

function FooterTrigger(props: FooterTriggerProps) {
  ensureCss()
  const open = useOpen()
  const wide = props.wide !== false
  return h('button', {
    type: 'button',
    className: 'dsh-proxy-trigger',
    'data-active': open ? true : undefined,
    title: 'dsh-proxy',
    'aria-label': 'dsh-proxy',
    onClick: () => openStore.set(!open),
  }, [
    h('span', { key: 'icon', className: 'dsh-proxy-trigger-icon' }, '🌐'),
    wide ? h('span', { key: 'label' }, 'dsh-proxy') : null,
  ])
}

function OverlayPanel(props: ProxyCardProps) {
  ensureCss()
  const open = useOpen()
  if (!open) return null
  return h('div', { className: 'dsh-proxy-overlay' }, [
    h('div', { key: 'header', className: 'dsh-proxy-overlay-header' }, [
      h('span', { key: 't', className: 't' }, 'dsh-proxy 管理'),
      h('button', { key: 'close', type: 'button', onClick: () => openStore.set(false) }, '关闭'),
    ]),
    h(ProxyCard, props),
  ])
}

export const name = 'dsh-proxy-client'
/** Required services (cordis fiber inject) — service names, not package names. */
export const inject = ['settingsScope', 'slots']

interface ClientContext {
  settingsScope: { bind(spec: { namespace: string }): SettingsScope }
  slots: {
    inject(name: string, callback: () => Iterable<unknown>): unknown
    register(entry: Record<string, unknown>, component: unknown): unknown
  }
}

export function apply(ctx: ClientContext): void {
  const controller = new ProxyCardController(ctx.settingsScope.bind({ namespace: NS }))
  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: NS,
        inject: () => controller.inject(),
      },
      ProxyCard,
    )
  })
  ctx.slots.inject('sidebar.footer.action', function* () {
    yield ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'dsh-proxy',
        order: 0,
        label: 'dsh-proxy',
      },
      FooterTrigger,
    )
  })
  ctx.slots.inject('shell.overlay', function* () {
    yield ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'dsh-proxy-panel',
        order: 10,
        inject: () => controller.inject(),
      },
      OverlayPanel,
    )
  })
}

export default { name, inject, apply }
