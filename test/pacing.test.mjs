// The re-dial storm guard, at the level undici 8 requires.
//
// The guard used to wrap the connector `ProxyAgent` handed to its `clientFactory`.
// undici 8 stopped passing one, so `paceDials` had nothing to wrap and the guard
// silently disengaged: a proxy that accepts a connection and then resets could be
// re-dialled as fast as undici could retry (the measured pre-guard figure was
// 11,282 connections in 3 s). The interval is now enforced by spacing calls into
// the proxy pool, which `PaceProxyDials` owns.
//
// Why this file builds its own context instead of using helpers.mjs: `boot`
// accelerates the 10 s probe heartbeat to 30 ms, and every probe is itself a call
// into the proxy pool — so the heartbeat would fill the pacing window the test is
// trying to measure. Here the production cadence stands, and the burst runs well
// inside the first 10 s tick.
//
// Run `pnpm build` first: these import the built artifact in lib/.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { apply } from '../lib/index.js'

/** The plugin's production liveness cadence; the burst below stays inside one tick. */
const PROBE_INTERVAL_MS = 10000
/** The plugin's production dial spacing, restated so the assertion is explicit. */
const DIAL_INTERVAL_MS = 400

/** A context shaped like the harness's fiber, recording log lines. */
function fakeContext() {
  const lines = []
  const listeners = new Map()
  return {
    lines,
    listeners,
    logger: () => ({
      info: (...a) => lines.push(a.map(String).join(' ')),
      warn: (...a) => lines.push(a.map(String).join(' ')),
      error: (...a) => lines.push(a.map(String).join(' ')),
      debug: () => {},
    }),
    on(event, fn) { listeners.set(event, fn) },
    emit(event, ...args) { listeners.get(event)?.(...args) },
    inject() {},
  }
}

/** A proxy that answers absolute-form requests and records when each arrived. */
async function timedProxy(port) {
  const state = { targets: [], at: [] }
  const server = createServer((req, res) => {
    state.targets.push(req.url)
    state.at.push(Date.now())
    req.resume()
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return { state, close: () => new Promise((resolve) => server.close(resolve)) }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('a burst into the proxy pool is spaced, and a lone call is not delayed', async (t) => {
  const port = 7974
  const proxy = await timedProxy(port)
  t.after(() => proxy.close())

  const ctx = fakeContext()
  t.after(() => ctx.emit('dispose'))
  apply(ctx, {
    enabled: true,
    host: '127.0.0.1',
    port,
    noProxy: ['localhost', '127.0.0.1', '::1', '[::1]'],
    autoReset: true,
    probeUrl: 'http://pace.dsh.invalid/models',
  })
  // Let the first liveness probe install the proxied dispatcher. That is the only
  // pool activity before the burst, and it happens well inside the window the
  // production cadence leaves open.
  await sleep(500)
  assert.ok(
    ctx.lines.some((line) => line.includes('mode direct→proxy')),
    `the proxied dispatcher must be installed first, got ${JSON.stringify(ctx.lines)}`,
  )

  // A lone call must not wait for the pacing window: the plugin's whole point is
  // that normal traffic is not slowed down.
  const mark = proxy.state.at.length
  const soloStart = Date.now()
  await fetch('http://solo.pace.invalid/x', { signal: AbortSignal.timeout(5000) })
  const soloMs = Date.now() - soloStart
  assert.ok(soloMs < DIAL_INTERVAL_MS / 2, `a lone call must be immediate, took ${soloMs}ms`)
  assert.deepEqual(
    proxy.state.targets.slice(mark),
    ['http://solo.pace.invalid/x'],
    'the lone call must have egressed through the proxy',
  )

  // Now a burst at distinct origins, which the pool cannot answer from one
  // connection. Consecutive arrivals must be spaced by the dial interval.
  const burstMark = proxy.state.at.length
  await Promise.all([
    fetch('http://a.pace.invalid/x', { signal: AbortSignal.timeout(8000) }),
    fetch('http://b.pace.invalid/x', { signal: AbortSignal.timeout(8000) }),
    fetch('http://c.pace.invalid/x', { signal: AbortSignal.timeout(8000) }),
  ])
  const burstAt = proxy.state.at.slice(burstMark)
  const burstTargets = proxy.state.targets.slice(burstMark)
  assert.equal(burstAt.length, 3, `all three burst calls must egress, saw ${JSON.stringify(burstTargets)}`)
  const gaps = burstAt.slice(1).map((at, index) => at - burstAt[index])
  assert.ok(
    gaps.every((gap) => gap >= DIAL_INTERVAL_MS * 0.9),
    `every burst gap must respect the ${DIAL_INTERVAL_MS}ms spacing, got ${JSON.stringify(gaps)}`,
  )
  assert.ok(PROBE_INTERVAL_MS > DIAL_INTERVAL_MS * 3, 'the cadence this test relies on must stay larger than the spacing')
})
