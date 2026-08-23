import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getGlobalDispatcher } from 'undici'
import { apply, proxyUrlOf, shouldBypass } from '../lib/index.js'

const PROXY_HOST = process.env.DSH_PROXY_TEST_HOST ?? '127.0.0.1'
const PROXY_PORT = Number(process.env.DSH_PROXY_TEST_PORT ?? 7890)
const ECHO_URL = 'https://api.ipify.org'

function fakeContext() {
  const listeners = new Map()
  return {
    listeners,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    on(event, fn) {
      listeners.set(event, fn)
    },
    emit(event, ...args) {
      listeners.get(event)?.(...args)
    },
    // No settings service mounted in tests: inject() simply never fires,
    // which is exactly the documented no-settings-service fallback path.
    inject() {},
  }
}

test('shouldBypass: exact, suffix, star, ipv6 brackets', () => {
  const list = ['localhost', '127.0.0.1', '::1', '[::1]', '.lan']
  assert.equal(shouldBypass('localhost', list), true)
  assert.equal(shouldBypass('127.0.0.1', list), true)
  assert.equal(shouldBypass('::1', list), true)
  assert.equal(shouldBypass('[::1]', list), true)
  assert.equal(shouldBypass('nas.lan', list), true)
  assert.equal(shouldBypass('lan', list), false)
  assert.equal(shouldBypass('api.51tokens.top', list), false)
  assert.equal(shouldBypass('anything.example', ['*']), true)
  assert.equal(shouldBypass('', list), false)
})

test('proxyUrlOf: composes host and port, brackets IPv6', () => {
  assert.equal(proxyUrlOf({ host: '127.0.0.1', port: 7890 }), 'http://127.0.0.1:7890')
  assert.equal(proxyUrlOf({ host: '::1', port: 7890 }), 'http://[::1]:7890')
  assert.equal(proxyUrlOf({}), 'http://127.0.0.1:7890')
  assert.throws(() => proxyUrlOf({ host: '', port: 7890 }), /host is empty/)
  assert.throws(() => proxyUrlOf({ host: '127.0.0.1', port: 0 }), /not a valid TCP port/)
  assert.throws(() => proxyUrlOf({ host: '127.0.0.1', port: 70000 }), /not a valid TCP port/)
})

test('apply installs a proxy dispatcher and dispose restores the previous one', () => {
  const before = getGlobalDispatcher()
  const ctx = fakeContext()
  apply(ctx, { enabled: true, host: PROXY_HOST, port: PROXY_PORT, noProxy: ['localhost'] })
  const during = getGlobalDispatcher()
  assert.notEqual(during, before, 'global dispatcher should be replaced while active')
  ctx.emit('dispose')
  assert.equal(getGlobalDispatcher(), before, 'dispose must restore the previous dispatcher')
})

test('enabled=false keeps the previous dispatcher untouched', () => {
  const before = getGlobalDispatcher()
  const ctx = fakeContext()
  apply(ctx, { enabled: false, host: PROXY_HOST, port: PROXY_PORT })
  assert.equal(getGlobalDispatcher(), before)
})

test('invalid host or port fails loudly', () => {
  const ctx = fakeContext()
  assert.throws(() => apply(ctx, { enabled: true, host: '', port: 7890 }), /host is empty/)
  assert.throws(() => apply(ctx, { enabled: true, host: '127.0.0.1', port: 70000 }), /not a valid TCP port/)
})

// Live network test: only runs when DSH_PROXY_LIVE=1 and a proxy is reachable.
test('live: global fetch exits through the proxy', { skip: process.env.DSH_PROXY_LIVE !== '1' }, async () => {
  const direct = await fetch(ECHO_URL).then((r) => r.text()).catch(() => null)
  const ctx = fakeContext()
  apply(ctx, { enabled: true, host: PROXY_HOST, port: PROXY_PORT, noProxy: [] })
  try {
    const viaProxy = await fetch(ECHO_URL).then((r) => r.text())
    assert.match(viaProxy, /^\d+\.\d+\.\d+\.\d+$/)
    if (direct !== null) {
      assert.notEqual(viaProxy, direct, 'proxy exit IP should differ from direct exit IP')
    }
    console.log(`direct=${direct} viaProxy=${viaProxy}`)
  } finally {
    ctx.emit('dispose')
  }
})
