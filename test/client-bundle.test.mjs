// Contract tests for the built browser half. Run `pnpm build` first: these read
// lib/client.js, so a stale lib/ means a stale bundle.
//
// Why evaluate the bundle instead of asserting on its text: the browser half's
// contract with this harness is entirely positional — which module-table
// specifiers it may require, which slot it registers into, and under which key.
// Every one of those fails SILENTLY when wrong (a missing module throws inside
// the bundle factory; a wrong slot key simply never renders), so the bundle is
// evaluated the way the web shell does it and the registration is inspected.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/**
 * Evaluate the bundle the way the web shell does: a page-global
 * `window.__ModuleLoader__.load({ id, factory })` registration that the shell's
 * module table records. The factory runs later, at materialization, and receives
 * the module-table `require` as its only argument.
 * @returns the recorded registration.
 */
function evaluateBundle() {
  let registration
  const page = {
    __ModuleLoader__: {
      load(entry) { registration = entry },
    },
  }
  new Function('window', source)(page)
  assert.ok(registration, 'the bundle must register a factory with the module table')
  return registration
}

/** A React stub: the bundle uses createElement, useState, and useEffect only. */
const reactStub = {
  createElement: (type, props, ...children) => ({
    type,
    props: {
      ...(props ?? {}),
      children: (props ?? {}).children ?? (children.length === 1 ? children[0] : children),
    },
  }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  Fragment: Symbol('Fragment'),
}

/** A primitives stub exposing exactly the shared settings-form surface used. */
const primitivesStub = {
  SettingsForm: function SettingsForm() {},
  SettingsValueField: function SettingsValueField() {},
  settingsNumberField: (field) => ({ field }),
  settingsTextField: (field) => ({ field }),
  SettingsFormModel: class SettingsFormModel {
    constructor(scope, specs) { this.scope = scope; this.specs = specs }
    bind(project) { return { getSnapshot: project, subscribe: () => () => {} } }
    shell() {
      return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
    }
    field(field) { return { text: `staged:${field}`, overridden: false, invalid: false } }
    actions() { return { edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {} } }
    dispose() {}
  },
}

/**
 * The module-table `require`. Throwing for anything else is the point: the web
 * shell seeds only react, react/jsx-runtime, react-dom, @deepseek-ai/cordis,
 * @deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
 * @deepseek-ai/dsh-client-ui-primitives and @deepseek-ai/dsh-client-ui-dockkit,
 * so any other specifier would need a `dsh.client.external` declaration.
 * @param specifier - the requested module.
 * @returns the stub for that module.
 */
function requireShim(specifier) {
  if (specifier === 'react') return reactStub
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
  throw new Error(`the bundle required "${specifier}", which the client module table does not seed`)
}

test('the browser half registers under the package name the boot graph uses', () => {
  assert.equal(evaluateBundle().id, 'dsh-proxy')
})

test('it materializes with nothing outside the client module table baseline', () => {
  const exports = evaluateBundle().factory(requireShim)
  assert.equal(typeof exports.apply, 'function')
})

test('it registers the third-party configuration seat for its own entry', () => {
  const exports = evaluateBundle().factory(requireShim)
  assert.deepEqual(exports.inject, ['slots', 'configForms', 'locale'])

  const injected = []
  const served = []
  const gets = []
  const dicts = []
  const registered = []
  const ctx = {
    slots: {
      inject(key, callback) { injected.push(key); return callback() },
      register(options, component) { registered.push({ options, component }); return () => {} },
    },
    configForms: {
      get(id) {
        gets.push(id)
        return {
          getSnapshot: () => ({ status: 'ready', value: {}, writable: true, base: {}, user: {}, revision: 0 }),
          subscribe: () => () => {},
          mutate: async () => true,
        }
      },
      whileServed(namespaces, register) { served.push([...namespaces]); return register(new Set(namespaces)) },
    },
    locale: {
      register(ns, locale, dict) { dicts.push({ ns, locale, dict }); return () => {} },
      bind: (ns) => (key, params) => (params === undefined ? `${ns}:${key}` : `${ns}:${key}:${JSON.stringify(params)}`),
    },
    effect(callback) { return callback() },
  }
  exports.apply(ctx)

  // The namespace is this plugin's own Loader entry id — the same string the
  // host half's diagnostic checks against and the bundle patch declares.
  assert.deepEqual(gets, ['dsh-proxy'])
  assert.deepEqual(served, [['dsh-proxy']], 'the card appears only while the Host serves this entry')
  assert.deepEqual(
    injected,
    ['plugins.bundle.config', 'plugins.row.config'],
    '`plugins.item` is reserved for the official host-plane plugins',
  )
  assert.deepEqual(dicts.map((d) => [d.ns, d.locale]), [['dshProxy', 'zh'], ['dshProxy', 'en']])
  assert.deepEqual(Object.keys(dicts[0].dict).sort(), Object.keys(dicts[1].dict).sort(), 'the two dictionaries must stay balanced')

  // BOTH seats, or the user gets no configuration at all: the package detail page
  // renders its configuration section only when `plugins.bundle.config` has an
  // occupant for that package name, and `plugins.row.config` belongs to the row's
  // own page.
  assert.deepEqual(
    registered.map(({ options }) => [options.name, options.key]),
    [
      ['plugins.bundle.config', 'dsh-proxy'],
      ['plugins.row.config', 'dsh-proxy#dsh-proxy'],
    ],
  )
  const { options, component } = registered[0]

  // The business face the slot entry supplies: the bound selector hook's source,
  // the form actions, and the translate.
  const face = options.inject()
  assert.deepEqual(Object.keys(face).sort(), ['discard', 'edit', 'hooks', 'resetField', 'save', 't'])
  assert.ok(face.hooks.proxyCard, 'the component reads its snapshot through this hook source')
  const props = {
    t: face.t,
    useProxyCard: (selector) => selector(face.hooks.proxyCard.getSnapshot()),
    edit: face.edit,
    resetField: face.resetField,
    save: face.save,
    discard: face.discard,
  }

  // The summary view is the row's one-liner.
  assert.equal(component({ view: 'summary', ...props }), 'dshProxy:description')

  // The page view renders the shared form frame around our controls.
  const tree = component({ view: 'page', ...props })
  assert.equal(tree.type, primitivesStub.SettingsForm)
  assert.equal(tree.props.labels.save, 'dshProxy:save')
  const children = tree.props.children
  assert.equal(children[0].type, 'div', 'the host status verdict comes first')
  assert.equal(children[1].type, 'label', 'then the enable toggle')
  assert.deepEqual(
    children.map((child) => child?.props?.id).filter(Boolean),
    ['dsh-proxy-host', 'dsh-proxy-port'],
  )
})

test('it no longer references the services this harness removed', () => {
  assert.doesNotMatch(source, /settingsScope/)
  assert.doesNotMatch(source, /settings\.plugin\.item/)
})
