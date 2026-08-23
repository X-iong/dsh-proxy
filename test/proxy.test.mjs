import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getGlobalDispatcher } from 'undici'
import { apply, shouldBypass } from '../lib/index.js'

const PROXY = process.env.DSH_PROXY_TEST_URL ?? 'http://127.0.0.1:7890'
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

test('apply installs a proxy dispatcher and dispose restores the previous one', async (t) => {
  const before = getGlobalDispatcher()
  const ctx = fakeContext()
  apply(ctx, { enabled: true, proxyUrl: PROXY, noProxy: ['localhost'] })
  const during = getGlobalDispatcher()
  assert.notEqual(during, before, 'global dispatcher should be replaced while active')
  ctx.emit('dispose')
  assert.equal(getGlobalDispatcher(), before, 'dispose must restore the previous dispatcher')
})

test('enabled=false keeps the previous dispatcher untouched', () => {
  const before = getGlobalDispatcher()
  const ctx = fakeContext()
  apply(ctx, { enabled: false, proxyUrl: PROXY })
  assert.equal(getGlobalDispatcher(), before)
})

test('invalid proxy URL fails loudly', () => {
  const ctx = fakeContext()
  assert.throws(() => apply(ctx, { enabled: true, proxyUrl: 'socks5://127.0.0.1:1080' }), /unsupported proxy protocol/)
  assert.throws(() => apply(ctx, { enabled: true, proxyUrl: 'not a url' }), /not a valid URL/)
})

// Live network test: only runs when DSH_PROXY_LIVE=1 and a proxy is reachable.
test('live: global fetch exits through the proxy', { skip: process.env.DSH_PROXY_LIVE !== '1' }, async () => {
  const direct = await fetch(ECHO_URL).then((r) => r.text()).catch(() => null)
  const ctx = fakeContext()
  apply(ctx, { enabled: true, proxyUrl: PROXY, noProxy: [] })
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
