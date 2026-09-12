// Self-heal behaviour tests for the Phase 2 decision table. Run `pnpm build` first:
// these import the built artifact in lib/, so a stale lib/ means a stale plugin.
//
// Design notes (learned the hard way):
//  * A tunnel failure is simulated by DESTROYING the socket on request, not by
//    accepting and staying silent. Silence forces the 8s UPSTREAM_TIMEOUT_MS,
//    which makes the test slow and racy; a reset fails in milliseconds.
//  * No mock.timers anywhere. Mocking Date freezes Date.now(), which silently
//    turns any Date.now()-based wait loop into an infinite loop.
//  * Each test uses its own port and disposes the plugin itself, so a leftover
//    dispatcher or listener cannot leak into the next test.
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { getGlobalDispatcher } from 'undici'
import { apply } from '../lib/index.js'

const PROBE_CADENCE_MS = 10000
const FAST_CADENCE_MS = 30

/** Wall clock the test controls; immune to Date being stubbed by anything. */
const realNow = () => Number(process.hrtime.bigint() / 1000000n)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate, timeoutMs, label) {
  const started = realNow()
  while (realNow() - started < timeoutMs) {
    if (predicate()) return true
    await sleep(5)
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label}`)
}

function modeOf() {
  const dispatcher = getGlobalDispatcher()
  if (dispatcher?.useProxy === true) return 'proxy'
  if (dispatcher?.useProxy === false) return 'direct'
  return `other(${dispatcher?.constructor?.name})`
}

/**
 * Fake proxy. `mode` is switched by the test:
 *   'healthy' -> answer every request with a well-formed 200
 *   'dead'    -> answer with a MALFORMED status line, so the probe fails at once
 * The listener itself stays up in both modes, so a spec that degrades while
 * 'dead' is exercising tunnel health and not port liveness.
 *
 * Why malformed instead of "accept and never reply" or "reset the socket":
 * measured against lib/index.js, both of those make undici retry the request in
 * a tight loop until the 8s UPSTREAM_TIMEOUT_MS abort fires (~17k requests to
 * the proxy). A protocol error is not retried: it fails in ~2ms with 1 request.
 * The never-replies case is the realistic one and is covered end-to-end by the
 * scenario harness against the real 8s timeout.
 */
async function fakeProxy(port) {
  const state = { mode: 'healthy', requests: 0 }
  const sockets = new Set()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.on('data', () => {
      state.requests += 1
      if (state.mode === 'healthy') {
        socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok')
      } else if (state.mode === 'silent') {
        // Accept and never answer, so the probe blocks until its own timeout —
        // the only way a test can close the port while a probe is truly in flight.
      } else {
        // Malformed status line -> immediate protocol error, no retry storm.
        // Deliberately `write`, not `end`: half-closing leaves a socket undici
        // keeps retrying on, which starves the next (healthy) probe.
        socket.write('HTTP/1.1 ABC Nope\r\nContent-Length: 2\r\n\r\nok')
      }
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return {
    state,
    async close() {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

/** Boot the plugin with the 10s probe cadence accelerated to FAST_CADENCE_MS. */
function boot(t, { port, probeUrl }) {
  const lines = []
  const logger = {
    info: (...a) => lines.push(a.map(String).join(' ')),
    warn: (...a) => lines.push(a.map(String).join(' ')),
    error: () => {},
    debug: () => {},
  }
  let dispose
  const ctx = {
    logger: () => logger,
    inject: () => {},
    on: (event, fn) => { if (event === 'dispose') dispose = fn },
  }
  const realSetInterval = globalThis.setInterval
  globalThis.setInterval = (fn, ms) => (ms === PROBE_CADENCE_MS ? realSetInterval(fn, FAST_CADENCE_MS) : realSetInterval(fn, ms))
  t.after(() => { globalThis.setInterval = realSetInterval })
  t.after(() => dispose?.())

  apply(ctx, {
    enabled: true,
    host: '127.0.0.1',
    port,
    noProxy: ['localhost', '127.0.0.1', '::1', '[::1]'],
    autoReset: true,
    probeUrl,
  })
  return {
    lines,
    transitions: () => lines.filter((line) => line.includes('dsh-proxy: mode ')),
    hasTransition: (needle) => lines.some((line) => line.includes(`dsh-proxy: mode ${needle}`)),
  }
}

const PROBE_URL = 'http://probe.dsh.invalid/models'

test('a healthy tunnel keeps the proxy installed and never degrades', async (t) => {
  const port = 7911
  const proxy = await fakeProxy(port)
  t.after(() => proxy.close())
  const { transitions, lines } = boot(t, { port, probeUrl: PROBE_URL })

  await waitFor(() => modeOf() === 'proxy', 5000, 'mode to become proxy')
  await sleep(400)
  assert.equal(modeOf(), 'proxy', 'a healthy tunnel must stay on the proxy')
  assert.ok(proxy.state.requests > 0, 'the upstream probe must really traverse the fake proxy')
  assert.deepEqual(lines.filter((line) => line.includes('upstream probe failed')), [], 'a healthy tunnel must not log upstream failures')
  assert.deepEqual(transitions(), [
    'dsh-proxy: mode none→direct reason=startup',
    'dsh-proxy: mode direct→proxy reason=port-reachable',
  ])
})

test('a failing upstream probe reports the tunnel broken WITHOUT leaving the proxy', async (t) => {
  const port = 7912
  const proxy = await fakeProxy(port)
  t.after(() => proxy.close())
  const { hasTransition, lines } = boot(t, { port, probeUrl: PROBE_URL })

  await waitFor(() => modeOf() === 'proxy', 5000, 'mode to become proxy on the healthy tunnel')

  // Tunnel dies but the listener stays up: the port answers, the tunnel does not.
  proxy.state.mode = 'dead'
  await waitFor(
    () => lines.some((line) => line.includes('隧道坏了')),
    5000,
    'the Chinese "tunnel is broken" warning',
  )

  // Policy B: being told is the whole response. Leaving the tunnel would move
  // every host-side request off it, and only the user knows whether direct
  // reaches the destinations they care about.
  assert.equal(modeOf(), 'proxy', 'the proxy must stay installed; the plugin never abandons the tunnel on its own')
  assert.equal(hasTransition('proxy→direct'), false, 'a broken tunnel must not produce a mode switch')
  assert.ok(
    lines.some((line) => line.includes('节点不可达')),
    `the warning must name the cause, got ${JSON.stringify(lines)}`,
  )
  assert.ok(
    lines.some((line) => line.includes('关闭代理改走直连')),
    'the warning must tell the user what to do',
  )
  // Regression: the warning once embedded the probe URL mid-sentence, and the host
  // log percent-encodes everything after a bare URL — turning "请切换到可用节点…"
  // into %E8%AF%B7… in a real run (2026-09-12 17:47). The URL now gets its own line.
  const warning = lines.find((line) => line.includes('隧道坏了')) ?? ''
  assert.ok(
    !/https?:\/\//.test(warning),
    `the warning must not embed a bare URL (got: ${warning})`,
  )
  assert.ok(lines.some((line) => line.includes('upstream probe failed')), 'the verdict must come from a failed upstream probe')

  // Healed tunnel: the verdict clears and routing never moved.
  proxy.state.mode = 'healthy'
  try {
    await waitFor(
      () => lines.some((line) => line.includes('隧道已恢复')),
      5000,
      'the Chinese "tunnel recovered" notice',
    )
  } catch (error) {
    throw new Error(`${error.message}\n  mode=${modeOf()}  proxyRequests=${proxy.state.requests}\n  lines=${JSON.stringify(lines)}`)
  }
  assert.equal(modeOf(), 'proxy', 'recovery must not move routing either')
})

test('a proxy that comes back after being absent is switched to again (recovery)', async (t) => {
  const port = 7914
  const proxy = await fakeProxy(port)
  t.after(() => proxy.close()) // idempotent: also covers the failure path below
  const first = boot(t, { port, probeUrl: PROBE_URL })

  await waitFor(() => modeOf() === 'proxy', 5000, 'mode to become proxy')
  await proxy.close()
  await waitFor(() => modeOf() === 'direct', 5000, 'fall back to direct once the port closes')
  assert.ok(first.hasTransition('proxy→direct reason=port-unreachable'))

  // The proxy comes back on the same endpoint (Clash restart, network change).
  // Nothing tells the plugin to look again: its own liveness probe must notice.
  const revived = await fakeProxy(port)
  t.after(() => revived.close())
  await waitFor(() => modeOf() === 'proxy', 5000, 'return to proxy once the endpoint answers again')
  assert.ok(
    first.hasTransition('direct→proxy reason=port-reachable'),
    `expected a second port-reachable switch back, got ${JSON.stringify(first.transitions())}`,
  )
  assert.deepEqual(
    first.transitions(),
    [
      'dsh-proxy: mode none→direct reason=startup',
      'dsh-proxy: mode direct→proxy reason=port-reachable',
      'dsh-proxy: mode proxy→direct reason=port-unreachable',
      'dsh-proxy: mode direct→proxy reason=port-reachable',
    ],
    'the full absence/recovery cycle must be visible in the transition log',
  )
})

test('a closed proxy port falls back to direct and reports port-unreachable', async (t) => {
  const port = 7913
  const proxy = await fakeProxy(port)
  t.after(() => proxy.close()) // idempotent: also covers the failure path below
  const { hasTransition } = boot(t, { port, probeUrl: PROBE_URL })

  await waitFor(() => modeOf() === 'proxy', 5000, 'mode to become proxy')
  await proxy.close()
  await waitFor(() => modeOf() === 'direct', 5000, 'fall back to direct once the port closes')
  assert.ok(
    hasTransition('proxy→direct reason=port-unreachable'),
    'a closed port must be reported as port-unreachable, not upstream-unreachable',
  )
})

test('a port that vanishes mid-probe is not reported as a broken node', async (t) => {
  const port = 7915
  const proxy = await fakeProxy(port)
  t.after(() => proxy.close())
  const { lines } = boot(t, { port, probeUrl: PROBE_URL })

  await waitFor(() => modeOf() === 'proxy', 5000, 'mode to become proxy')

  // Stop answering so the next upstream probe blocks on its own timeout, then pull
  // the port out from under it. Observed in a real run (2026-09-12 18:01:21): the
  // port disappeared, the plugin correctly went direct, and a stale in-flight probe
  // finished 3 ms later and announced "代理节点不可达" — naming the wrong cause.
  proxy.state.mode = 'silent'
  await sleep(400)
  assert.equal(modeOf(), 'proxy', 'the tunnel still looks usable until the port actually goes')
  await proxy.close()
  await waitFor(() => modeOf() === 'direct', 5000, 'fall back to direct once the port closes')

  // Let the stale probe reach its timeout and be discarded.
  await sleep(3500)
  const lied = lines.filter((line) => line.includes('隧道坏了'))
  assert.deepEqual(
    lied,
    [],
    `a vanished port must not be reported as a broken node, got ${JSON.stringify(lines)}`,
  )
})
