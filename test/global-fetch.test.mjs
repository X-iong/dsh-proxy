// The end-to-end contract this plugin exists for: Node's BUILT-IN `fetch` must
// leave through the configured proxy while the plugin is mounted.
//
// Why this file is separate from proxy.test.mjs: the assertions there read
// `getGlobalDispatcher()` (undici's `.2` slot), which the plugin writes whether
// or not the traffic is actually intercepted. Node's built-in `fetch` reads
// `Symbol.for('undici.globalDispatcher.1')` instead, and that slot is where the
// 0.3.1 build stopped working: an undici-7 dispatcher placed there is never
// bridged to the handler contract Node 24 hands down, so `fetch()` hung until
// its abort fired and the proxy was never dialled — while every assertion in
// proxy.test.mjs still passed. This file drives REAL requests through a loopback
// proxy and asserts where they landed.
//
// Run `pnpm build` first: these import the built artifact in lib/.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as createSocketServer } from 'node:net'
import { test } from 'node:test'
import { boot, sleep, waitFor, modeOf } from './helpers.mjs'

/** The dispatcher slot Node's built-in fetch resolves for a request. */
const LEGACY_SLOT = Symbol.for('undici.globalDispatcher.1')

/**
 * An HTTP proxy that answers absolute-form requests itself, so a request that
 * really traversed it is distinguishable from a direct one, and can only be
 * observed here — it never reaches the origin.
 * @param port - loopback port to listen on.
 * @returns the recorded absolute-form URLs and a close().
 */
async function absoluteProxy(port) {
  const state = { targets: [], at: [] }
  const server = createServer((req, res) => {
    state.targets.push(req.url)
    state.at.push(Date.now())
    req.resume()
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(`via-proxy:${req.url}`)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return { state, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('the built-in global fetch really leaves through the configured proxy', async (t) => {
  const port = 7961
  const proxy = await absoluteProxy(port)
  t.after(() => proxy.close())
  boot(t, { port, probeUrl: 'http://probe.dsh.invalid/models' })
  await waitFor(() => modeOf() === 'proxy', 5000, 'mode to become proxy')

  // A host that is NOT on the bypass list, so the router must choose the proxy.
  const response = await fetch('http://global-fetch.dsh.invalid/models', {
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(response.status, 200, 'the built-in fetch must complete through the proxy')
  assert.equal(
    await response.text(),
    'via-proxy:http://global-fetch.dsh.invalid/models',
    "the body must be the PROXY's answer, proving the request traversed it",
  )
  assert.deepEqual(
    proxy.state.targets,
    ['http://global-fetch.dsh.invalid/models'],
    'the proxy must have seen the absolute-form target exactly once',
  )
})

test('a bypass-listed host still goes direct while the proxy is installed', async (t) => {
  const port = 7962
  const proxy = await absoluteProxy(port)
  t.after(() => proxy.close())
  // An origin server the bypass list points at, standing in for a local service.
  const originPort = 7963
  const origin = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('direct:ok')
  })
  await new Promise((resolve) => origin.listen(originPort, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => origin.close(resolve)))

  boot(t, { port, probeUrl: 'http://probe.dsh.invalid/models' })
  await waitFor(() => modeOf() === 'proxy', 5000, 'mode to become proxy')

  const response = await fetch(`http://127.0.0.1:${originPort}/local`, {
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(await response.text(), 'direct:ok', 'a bypassed host must be answered by the origin')
  assert.deepEqual(proxy.state.targets, [], 'a bypassed host must never reach the proxy')
})

test('a wire failure through the proxy is observed and retold in Chinese', async (t) => {
  const port = 7965
  // A proxy that answers the plugin's own upstream probe (so the tunnel verdict
  // stays "healthy" and the only thing that can raise suspicion is real traffic)
  // and RESETS the socket for every other request. The failure therefore exists
  // only on the wire, which is exactly what the plugin's error hook must observe.
  const sockets = new Set()
  let dialled = 0
  const firstLines = []
  // A raw TCP server: an http.Server would consume the request line before a
  // 'data' listener could see it.
  const hostile = createSocketServer((socket) => {
    dialled += 1
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.once('data', (chunk) => {
      const text = chunk.toString('latin1')
      firstLines.push(text.split('\r\n')[0])
      if (text.includes('dsh.invalid')) {
        // The traffic request: fail it on the wire, mid-request.
        socket.resetAndDestroy()
        return
      }
      // The plugin's own probe: answer it, so the tunnel verdict stays healthy
      // and real traffic is the only thing that can raise suspicion.
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok')
    })
  })
  await new Promise((resolve) => hostile.listen(port, '127.0.0.1', resolve))
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => hostile.close(resolve))
  })

  const { ctx, lines } = boot(t, { port, probeUrl: 'http://probe.dsh.invalid/models' })
  await waitFor(() => modeOf() === 'proxy', 5000, 'mode to become proxy on a listening port')
  await fetch('http://reset.dsh.invalid/models', { signal: AbortSignal.timeout(5000) }).catch(() => {})
  assert.ok(dialled > 0, 'the request must really have been sent to the proxy')
  assert.ok(
    !lines.some((line) => line.includes('隧道坏了')),
    `the traffic failure must be the only thing raising suspicion, got ${JSON.stringify(lines)}\n  firstLines=${JSON.stringify(firstLines)}`,
  )

  // The observable consequence: a model call that dies on the wire while the
  // tunnel is under suspicion is retold in Chinese (see maybeRenameTunnelFailure).
  // If the error hook never saw the failure, that rewrite cannot happen — this is
  // the 0.3.1 behaviour, where the handler was wrapped through a name the modern
  // handler does not have (`onError`), so no traffic failure was ever observed.
  const stream = ctx.listeners.get('llm/stream')?.(() => (async function* () {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', message: 'DeepSeek API stream failed' } } }
  })())
  assert.ok(stream, 'the llm/stream waterfall must return the wrapped stream')
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  assert.equal(chunks.length, 1, 'the wrapper must forward the stream unchanged in shape')
  assert.match(
    chunks[0].reason.failure.message,
    /dsh-proxy: 这次模型请求经代理出站失败/,
    'a wire failure on a suspect tunnel must be retold in Chinese',
  )
  assert.equal(chunks[0].reason.failure.code, 'TRANSPORT', 'the failure code must not be rewritten')
})

test('the legacy dispatcher slot built-in fetch reads is a proxy-routing dispatcher', async (t) => {
  const port = 7964
  const proxy = await absoluteProxy(port)
  t.after(() => proxy.close())
  const { ctx } = boot(t, { port, probeUrl: 'http://probe.dsh.invalid/models' })
  await waitFor(() => modeOf() === 'proxy', 5000, 'mode to become proxy')

  // Node's built-in fetch resolves this slot, never `getGlobalDispatcher()`.
  // undici 8 keeps it working by wrapping what we install in a
  // Dispatcher1Wrapper; undici 7 did not, which is the regression this guards.
  const slot = globalThis[LEGACY_SLOT]
  assert.ok(slot, 'the legacy global dispatcher slot must be claimed')
  assert.equal(typeof slot.dispatch, 'function', 'the slot must hold a dispatcher')
  const seenBySlot = []
  assert.equal(
    slot.dispatch(
      { origin: 'http://slot.dsh.invalid', path: '/slot', method: 'GET' },
      {
        onRequestStart: () => {},
        onResponseStart: () => { seenBySlot.push('response') },
        onResponseData: () => {},
        onResponseEnd: () => {},
        onResponseError: () => { seenBySlot.push('error') },
      },
    ),
    true,
    'dispatching straight at the legacy slot must be accepted',
  )
  await waitFor(() => seenBySlot.length > 0, 5000, 'the legacy slot to answer')
  assert.equal(seenBySlot[0], 'response', 'the built-in fetch path must be answered')

  ctx.emit('dispose')
  await sleep(20)
  assert.notEqual(globalThis[LEGACY_SLOT], slot, 'dispose must release the slot back to the previous dispatcher')
})
