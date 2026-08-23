import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

// Resolve the plugin exactly the way the DSH web profile would: from the
// profile's own node_modules, post-install.
const require = createRequire('C:/Users/admin/.dsh/profiles/web/node_modules/dsh-proxy/package.json')
const { apply } = await import(
  'file:///C:/Users/admin/.dsh/profiles/web/node_modules/dsh-proxy/lib/index.js'
)

const API = 'https://api.51tokens.top/v1/models'
const KEY = process.env.DSH_TEST_51TOKENS_KEY
const PROXY = process.env.DSH_PROXY_TEST_URL ?? 'http://127.0.0.1:7890'

function fakeContext() {
  const listeners = new Map()
  return {
    listeners,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    on(event, fn) { listeners.set(event, fn) },
    emit(event, ...args) { listeners.get(event)?.(...args) },
  }
}

test('installed plugin routes the real 51tokens /models fetch through the proxy', async () => {
  if (!KEY) {
    console.log('DSH_TEST_51TOKENS_KEY not set; skipping live API assertion')
    return
  }
  const ctx = fakeContext()
  apply(ctx, { enabled: true, proxyUrl: PROXY, noProxy: ['localhost', '127.0.0.1', '::1'] })
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
