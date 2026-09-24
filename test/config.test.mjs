// Configuration-contract tests for the 0.1.7-rc.1 port. Run `pnpm build` first:
// these import the built artifact in lib/, so a stale lib/ means a stale plugin.
//
// What changed and why these assertions exist: before this port the plugin
// registered a settings NAMESPACE of its own (`installSection`). That API is
// gone — a plugin's editable configuration is now simply its own Loader entry,
// the framework derives the form from the exported `Config` schema, and only
// schema nodes marked `.volatile()` are editable at all. The failure mode is
// silent: drop a `.volatile()` and the field just stops appearing on the card,
// with no error anywhere. Hence the schema assertion below.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getGlobalDispatcher } from 'undici'
import { Config, apply, configDiffers, readConfig, readField } from '../lib/index.js'
import { boot, fakeContext, fakeProxy, modeOf, volatileRef, waitFor } from './helpers.mjs'

const PROBE_URL = 'http://probe.dsh.invalid/models'

/** A fully volatile config, the way the Loader hands one to a plugin. */
function volatileConfig(overrides = {}) {
  return {
    enabled: volatileRef(true),
    host: volatileRef('127.0.0.1'),
    noProxy: volatileRef(['localhost', '127.0.0.1', '::1']),
    autoReset: volatileRef(true),
    probeUrl: volatileRef(PROBE_URL),
    ...overrides,
  }
}

test('every Config field is volatile, so the configuration card can edit all of them', () => {
  // schemastery serializes as a reference table: `refs` holds every node keyed by
  // id, and `uid` points at this schema's root.
  const json = Config.toJSON()
  const root = json.refs[String(json.uid)]
  assert.equal(root.type, 'object')
  assert.deepEqual(
    Object.keys(root.dict).sort(),
    ['autoReset', 'enabled', 'host', 'noProxy', 'port', 'probeUrl'],
  )
  for (const [field, id] of Object.entries(root.dict)) {
    assert.equal(
      json.refs[String(id)].meta?.volatile,
      true,
      `Config.${field} must be .volatile(), or the card cannot edit it`,
    )
  }
})

test('readField reads a volatile reference and passes a plain value through', () => {
  assert.equal(readField(volatileRef(7890), 1), 7890)
  assert.equal(readField(7890, 1), 7890)
  assert.equal(readField(false, true), false)
  assert.equal(readField(undefined, 1), 1)
  assert.equal(readField(null, 1), 1)
})

test('readConfig re-reads live references instead of caching a snapshot', () => {
  const port = volatileRef(7890)
  const raw = volatileConfig({ port })
  assert.equal(readConfig(raw).port, 7890)
  // The Loader commits a new value into the reference IN PLACE, without
  // remounting the plugin — so a read after the commit must see it.
  port.set(7891)
  assert.equal(readConfig(raw).port, 7891, 'a cached snapshot would still say 7890')
})

test('readConfig falls back to the schema defaults for an absent config', () => {
  const cfg = readConfig(undefined)
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.host, '127.0.0.1')
  assert.equal(cfg.port, 7890)
  assert.deepEqual(cfg.noProxy, ['localhost', '127.0.0.1', '::1', '[::1]'])
  assert.equal(cfg.autoReset, true)
  assert.equal(cfg.probeUrl, 'https://api.deepseek.com/models')
})

test('configDiffers detects only real endpoint or behaviour moves', () => {
  const base = {
    enabled: true,
    host: '127.0.0.1',
    port: 7890,
    noProxy: ['a'],
    autoReset: true,
    probeUrl: 'http://p/',
  }
  assert.equal(configDiffers(base, { ...base }), false)
  assert.equal(configDiffers(base, { ...base, port: 7891 }), true)
  assert.equal(configDiffers(base, { ...base, host: '10.0.0.1' }), true)
  assert.equal(configDiffers(base, { ...base, enabled: false }), true)
  assert.equal(configDiffers(base, { ...base, autoReset: false }), true)
  assert.equal(configDiffers(base, { ...base, probeUrl: 'http://q/' }), true)
  assert.equal(configDiffers(base, { ...base, noProxy: ['a', 'b'] }), true)
  assert.equal(configDiffers(base, { ...base, noProxy: ['b'] }), true)
  assert.deepEqual(
    configDiffers(base, { ...base, noProxy: ['a'] }),
    false,
    'an equal list must not count as a move',
  )
})

test('the plugin registers no settings namespace: its Loader entry id IS the namespace', () => {
  const ctx = fakeContext()
  // enabled=false keeps the global dispatcher untouched, so this asserts the
  // registration surface without disturbing other tests.
  apply(ctx, { enabled: false, host: '127.0.0.1', port: 7890 })
  ctx.emit('dispose')
  const injected = ctx.injected.flatMap(([services]) => services)
  assert.deepEqual(
    injected,
    ['webServer'],
    'the status route is the only injection left; the old host half also injected `settings`',
  )
})

test('a loader/volatile-update commit reconfigures the dispatcher immediately', async (t) => {
  const port = 7931
  const proxy = await fakeProxy(port)
  t.after(() => proxy.close())

  const portRef = volatileRef(port)
  const { ctx, lines } = boot(t, {
    port,
    probeUrl: PROBE_URL,
    config: volatileConfig({ port: portRef }),
  })

  await waitFor(() => modeOf() === 'proxy', 5000, 'mode to become proxy')
  const before = getGlobalDispatcher()

  // Move the endpoint and publish the commit. Asserted SYNCHRONOUSLY: the
  // liveness tick is 30 ms away in this harness, so a reconfigure line that
  // already exists could only have come from the event listener.
  portRef.set(port + 100)
  ctx.emit('loader/volatile-update')
  assert.ok(
    lines.some((line) => line.includes('mode proxy→direct reason=reconfigured')),
    `the event must reconfigure at once, got ${JSON.stringify(lines)}`,
  )
  assert.notEqual(getGlobalDispatcher(), before, 'the dispatcher must be replaced')
})

test('an endpoint move that never notifies is still picked up by the liveness tick', async (t) => {
  const first = 7932
  const second = 7933
  const proxyFirst = await fakeProxy(first)
  const proxySecond = await fakeProxy(second)
  t.after(() => proxyFirst.close())
  t.after(() => proxySecond.close())

  const portRef = volatileRef(first)
  const { lines } = boot(t, {
    port: first,
    probeUrl: PROBE_URL,
    config: volatileConfig({ port: portRef }),
  })

  await waitFor(() => modeOf() === 'proxy', 5000, 'mode to become proxy on the first endpoint')
  // The port probe flips routing on its own cadence; the end-to-end upstream
  // probe runs only every UPSTREAM_PROBE_EVERY-th cycle, so wait for it.
  await waitFor(() => proxyFirst.state.requests > 0, 5000, 'the first endpoint to carry the probe')

  // Move the endpoint and say NOTHING — no event at all. The drift check on the
  // liveness tick is the safety net that keeps this from being a silent failure.
  portRef.set(second)
  await waitFor(
    () => proxySecond.state.requests > 0,
    5000,
    'traffic to reach the new endpoint without any notification',
  )
  assert.ok(
    lines.some((line) => line.includes('reason=reconfigured')),
    `the drift must be reported as a reconfigure, got ${JSON.stringify(lines)}`,
  )
})

test('a non-canonical Loader entry id is reported rather than silently losing the card', () => {
  const lines = []
  const ctx = fakeContext()
  ctx.logger = () => ({
    info: (message) => lines.push(String(message)),
    warn: (message) => lines.push(String(message)),
    error: () => {},
    debug: () => {},
  })
  ctx.fiber = {}
  ctx.loader = { locate: () => 'my-proxy' }
  apply(ctx, { enabled: false, host: '127.0.0.1', port: 7890 })
  ctx.emit('dispose')
  assert.ok(
    lines.some((line) => line.includes('my-proxy') && line.includes('dsh-proxy')),
    `a mismatched row id must be named, got ${JSON.stringify(lines)}`,
  )
})

/**
 * A web server stand-in that behaves like the real one where it matters:
 * registering the same (kind, path) twice throws, and only the returned disposer
 * releases the route. `WebServer.register` is not fiber-scoped, so a plugin that
 * drops that disposer leaks its route and dies on its next reload.
 * @returns the live route table and the service to inject.
 */
function webHarness() {
  const routes = new Map()
  return {
    routes,
    webServer: {
      register(route) {
        if (routes.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
        routes.set(route.path, route)
        return () => { routes.delete(route.path) }
      },
    },
  }
}

test('the status route dies with the plugin, so a reload can claim it again', () => {
  const harness = webHarness()
  const mount = () => {
    const ctx = fakeContext()
    ctx.inject = (services, callback) => {
      if (services.includes('webServer')) callback({ webServer: harness.webServer, effect: ctx.effect })
    }
    apply(ctx, { enabled: false, host: '127.0.0.1', port: 7890 })
    return ctx
  }

  const first = mount()
  assert.deepEqual([...harness.routes.keys()], ['/dsh-proxy/status'])

  first.emit('dispose')
  assert.deepEqual([...harness.routes.keys()], [], 'an unloaded plugin must not leave its route behind')

  // Same route table, second mount: this is the reload that used to die on
  // `webserver: duplicate exact route` because the first mount never released it.
  const reloaded = mount()
  assert.deepEqual([...harness.routes.keys()], ['/dsh-proxy/status'])
  reloaded.emit('dispose')
})
