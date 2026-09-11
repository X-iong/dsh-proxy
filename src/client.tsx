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

/**
 * Bump this when the stylesheet changes: the tag is installed once per page and
 * a stale tag would otherwise keep winning after a client-half reload.
 */
const CSS_TAG = 'dsh-proxy/ProxyCard.module.css?v2'

/**
 * The card chrome mirrors the built-in plugin cards in
 * `ui-settings-plugins/PluginCard.module.css` (same geometry, palette, and
 * disclosure behaviour) so this card sits in the list as a peer of 终端 /
 * Agent 循环 / Subagent / 网页搜索 rather than as a foreign box. The values are
 * copied deliberately: the section renders its cards inside a `<ul>`, so the
 * root has to be an `<li>` and the header its own button.
 */
const CSS = `
.dsh-proxy-card{list-style:none;border:0.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}
.dsh-proxy-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-proxy-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dsh-proxy-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.dsh-proxy-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-proxy-headtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-proxy-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-proxy-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-proxy-pending{flex:none;border:0.5px solid var(--dsw-alias-border-l4);border-radius:999px;padding:1px 8px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.dsh-proxy-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dsh-proxy-chevron-open{transform:rotate(180deg)}
.dsh-proxy-body{border-top:0.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dsh-proxy-readonly{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-proxy-toggle{display:flex;align-items:center;gap:8px;padding:12px 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-proxy-toggle input{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.dsh-proxy-row{display:flex;gap:12px;padding:12px 0 0;border-top:0.5px solid var(--dsw-alias-border-l2)}
.dsh-proxy-row .grow{flex:1;min-width:0}
.dsh-proxy-field{display:flex;flex-direction:column;gap:6px}
.dsh-proxy-field-head{display:flex;align-items:center;gap:8px}
.dsh-proxy-field-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-proxy-field-reset{border:none;background:none;padding:0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-proxy-field-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.dsh-proxy-field-reset:disabled{cursor:default;opacity:.4}
.dsh-proxy-input{height:34px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);width:100%;box-sizing:border-box}
.dsh-proxy-input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dsh-proxy-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dsh-proxy-input-invalid{border-color:var(--dsw-alias-label-error)}
.dsh-proxy-invalid{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}
.dsh-proxy-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-proxy-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:0.5px solid var(--dsw-alias-border-l2)}
.dsh-proxy-failed{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}
.dsh-proxy-discard,.dsh-proxy-save{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.dsh-proxy-discard{border-color:var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary)}
.dsh-proxy-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dsh-proxy-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsh-proxy-discard:disabled,.dsh-proxy-save:disabled{opacity:.4;cursor:default}
.dsh-proxy-discard:focus-visible,.dsh-proxy-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
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

/** `ic_ds_chevron_down_outline_14` from the client primitives, inlined. */
const CHEVRON_PATH =
  'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732C6.59876 8.24849C6.74023 8.3623C6.87291 8.46904C6.92272 8.47813C6.9375 8.48047C6.97895 8.48703C7.02105 8.48703C7.0625 8.48047C7.07728 8.47813C7.12709 8.46904C7.25977 8.3623C7.40124 8.24849C7.57405 8.07732C7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z'

function Chevron(props: { open: boolean }) {
  return h(
    'svg',
    {
      className: props.open ? 'dsh-proxy-chevron dsh-proxy-chevron-open' : 'dsh-proxy-chevron',
      width: 14,
      height: 14,
      viewBox: '0 0 14 14',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': true,
      focusable: false,
    },
    h('path', { d: CHEVRON_PATH, fill: 'currentColor' }),
  )
}

interface FieldProps {
  id: string
  label: string
  hint: string
  invalidLabel: string
  value: string
  invalid: boolean
  overridden: boolean
  disabled: boolean
  placeholder?: string
  onEdit: (text: string) => void
  onReset: () => void
}

function Field(props: FieldProps) {
  return h('div', { className: 'dsh-proxy-field' }, [
    h('div', { key: 'head', className: 'dsh-proxy-field-head' }, [
      h('label', { key: 'label', className: 'dsh-proxy-field-label', htmlFor: props.id }, props.label),
      props.overridden
        ? h(
            'button',
            { key: 'reset', type: 'button', className: 'dsh-proxy-field-reset', disabled: props.disabled, onClick: props.onReset },
            '重置',
          )
        : null,
    ]),
    h('input', {
      key: 'input',
      id: props.id,
      type: 'text',
      className: props.invalid ? 'dsh-proxy-input dsh-proxy-input-invalid' : 'dsh-proxy-input',
      value: props.value,
      placeholder: props.placeholder ?? '',
      disabled: props.disabled,
      onChange: (event: any) => props.onEdit(event.target.value),
    }),
    h(
      'p',
      { key: 'hint', className: props.invalid ? 'dsh-proxy-invalid' : 'dsh-proxy-hint' },
      props.invalid ? props.invalidLabel : props.hint,
    ),
  ])
}

interface ProxyCardProps {
  useProxyCard: <T>(selector: (snapshot: CardProjection) => T) => T
  edit: (field: string, value: any) => void
  resetField: (field: string) => void
  save: () => void
  discard: () => void
}

/**
 * The plugin's card. Collapsed by default, like every peer card in the list.
 *
 * Unlike the built-in cards this one stays mounted when the namespace is not
 * yet readable — the host half ships in the same package, so the card only
 * exists when the namespace does, and a card that vanished mid-load would take
 * the only proxy control with it. It renders read-only instead.
 */
function ProxyCard(props: ProxyCardProps) {
  ensureCss()
  const [open, setOpen] = React.useState(false)
  const saveStarted = React.useRef(false)
  const state = props.useProxyCard((snapshot) => snapshot)

  // Collapse only after the write settles cleanly; a rejected save keeps its
  // diagnostics and staged drafts visible for correction.
  React.useEffect(() => {
    if (state.saving) {
      saveStarted.current = true
      return
    }
    if (!saveStarted.current) return
    saveStarted.current = false
    if (!state.dirty && !state.failed) setOpen(false)
  }, [state.dirty, state.failed, state.saving])

  const disabled = !state.writable || state.saving
  const blocked = !state.dirty || state.invalid || state.saving

  return h('li', { className: open ? 'dsh-proxy-card dsh-proxy-card-open' : 'dsh-proxy-card' }, [
    h(
      'button',
      {
        key: 'header',
        type: 'button',
        className: 'dsh-proxy-header',
        'aria-expanded': open,
        'aria-label': `${open ? '收起' : '展开'}: dsh-proxy`,
        onClick: () => setOpen(!open),
      },
      [
        h('span', { key: 'text', className: 'dsh-proxy-headtext' }, [
          h('span', { key: 'name', className: 'dsh-proxy-name' }, 'dsh-proxy'),
          h(
            'span',
            { key: 'desc', className: 'dsh-proxy-desc' },
            '自定义 HTTP 代理：让 DSH 宿主进程的全部 fetch（LLM 请求、模型发现、市场、web 搜索）经代理出站。',
          ),
        ]),
        state.dirty ? h('span', { key: 'pending', className: 'dsh-proxy-pending' }, '未保存') : null,
        h(Chevron, { key: 'chevron', open }),
      ],
    ),
    open
      ? h('div', { key: 'body', className: 'dsh-proxy-body' }, [
          !state.available
            ? h('p', { key: 'ro', className: 'dsh-proxy-readonly', role: 'status' }, '设置尚未就绪，暂时只读。')
            : null,
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
                overridden: state.host.overridden,
                disabled,
                onEdit: (text: string) => props.edit('host', text),
                onReset: () => props.resetField('host'),
              }),
            ),
            h(
              'div',
              { key: 'port', style: { width: '160px', flex: 'none' } },
              h(Field, {
                id: 'dsh-proxy-port',
                label: '端口',
                hint: '例如 7890',
                invalidLabel: '无效端口',
                value: state.port.value,
                invalid: state.port.invalid,
                overridden: state.port.overridden,
                disabled,
                onEdit: (text: string) => props.edit('port', text),
                onReset: () => props.resetField('port'),
              }),
            ),
          ]),
          h('div', { key: 'footer', className: 'dsh-proxy-footer' }, [
            state.failed
              ? h('p', { key: 'failed', className: 'dsh-proxy-failed', role: 'status' }, '保存被拒绝，请检查值后重试')
              : null,
            h(
              'button',
              { key: 'discard', type: 'button', className: 'dsh-proxy-discard', disabled: !state.dirty || state.saving, onClick: props.discard },
              '放弃',
            ),
            h(
              'button',
              { key: 'save', type: 'button', className: 'dsh-proxy-save', disabled: blocked, onClick: props.save },
              state.saving ? '保存中…' : '保存',
            ),
          ]),
        ])
      : null,
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

/**
 * The card is the plugin's only UI surface: it is contributed to the Plugins
 * settings section and owns its own disclosure, exactly like the built-in
 * plugin cards. There is deliberately no separate sidebar entry or floating
 * panel — a second copy of the same form was only a way to get to the first.
 */
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
}

export default { name, inject, apply }
