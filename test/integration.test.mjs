import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

// This is a LIVE integration check: it needs a real proxy and a real API key, and
// it exercises an *installed* copy of the plugin (the way a DSH profile resolves
// it) rather than the local lib/. It therefore skips itself unless both are
// configured, so the suite stays green on a plain checkout.
//
//   DSH_PROXY_INTEGRATION_TARGET=C:/Users/me/.dsh/profiles/web/node_modules/dsh-proxy/lib/index.js
//   DSH_TEST_51TOKENS_KEY=...
const TARGET = process.env.DSH_PROXY_INTEGRATION_TARGET
const API = 'https://api.51tokens.top/v1/models'
const KEY = process.env.DSH_TEST_51TOKENS_KEY
const PROXY_HOST = process.env.DSH_PROXY_TEST_HOST ?? '127.0.0.1'
const PROXY_PORT = Number(process.env.DSH_PROXY_TEST_PORT ?? 7890)

function fakeContext() {
  const listeners = new Map()
  return {
    listeners,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    on(event, fn) { listeners.set(event, fn) },
    emit(event, ...args) { listeners.get(event)?.(...args) },
    inject() {},
  }
}

test('installed plugin routes the real 51tokens /models fetch through the proxy', async (t) => {
  if (!TARGET || !existsSync(TARGET)) {
    t.skip('set DSH_PROXY_INTEGRATION_TARGET to an installed lib/index.js to run this')
    return
  }
  if (!KEY) {
    t.skip('set DSH_TEST_51TOKENS_KEY to run the live API assertion')
    return
  }

  const { apply } = await import(pathToFileURL(TARGET).href)
  const ctx = fakeContext()
  apply(ctx, { enabled: true, host: PROXY_HOST, port: PROXY_PORT, noProxy: ['localhost', '127.0.0.1', '::1'] })
  try {
    const res = await fetch(API, { headers: { authorization: `Bearer ${KEY}` } })
    assert.equal(res.status, 200, `expected 200 through proxy, got ${res.status}`)
    const body = await res.json()
    assert.ok(Array.isArray(body.data) && body.data.length > 0, 'model list must be non-empty')
    console.log(`OK: ${body.data.length} models visible through proxy`)
  } finally {
    ctx.emit('dispose')
  }
})
