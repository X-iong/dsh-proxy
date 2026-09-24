// Shared scaffolding for the dsh-proxy test suite.
//
// Run `pnpm build` first: every test imports the built artifact in lib/, so a
// stale lib/ means a stale plugin.
//
// Design notes (learned the hard way):
//  * A tunnel failure is simulated by DESTROYING the socket on request, not by
//    accepting and staying silent. Silence forces the 8s UPSTREAM_TIMEOUT_MS,
//    which makes a test slow and racy; a reset fails in milliseconds.
//  * No mock.timers anywhere. Mocking Date freezes Date.now(), which silently
//    turns any Date.now()-based wait loop into an infinite loop.
//  * Each test uses its own port and disposes the plugin itself, so a leftover
//    dispatcher or listener cannot leak into the next test.
import { createServer } from 'node:net'
import { getGlobalDispatcher } from 'undici'
import { apply } from '../lib/index.js'

/** The plugin's liveness/probe cadence; `boot` accelerates it. */
export const PROBE_CADENCE_MS = 10000
/** Accelerated cadence the tests run at. */
export const FAST_CADENCE_MS = 30

/** Wall clock the test controls; immune to Date being stubbed by anything. */
export const realNow = () => Number(process.hrtime.bigint() / 1000000n)

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Poll a predicate until it holds.
 * @param predicate - condition under test.
 * @param timeoutMs - how long to keep trying.
 * @param label - what was being waited for, named in the failure.
 * @returns true once the predicate held.
 */
export async function waitFor(predicate, timeoutMs, label) {
  const started = realNow()
  while (realNow() - started < timeoutMs) {
    if (predicate()) return true
    await sleep(5)
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label}`)
}

/** The routing mode the globally installed dispatcher reports. */
export function modeOf() {
  const dispatcher = getGlobalDispatcher()
  if (dispatcher?.useProxy === true) return 'proxy'
  if (dispatcher?.useProxy === false) return 'direct'
  return `other(${dispatcher?.constructor?.name})`
}

/**
 * Fake proxy. `mode` is switched by the test:
 *   'healthy' -> answer every request with a well-formed 200
 *   'dead'    -> answer with a MALFORMED status line, so the probe fails at once
 *   'silent'  -> accept and never answer, so a probe blocks until its own timeout
 * The listener itself stays up in every mode, so a spec that degrades while
 * 'dead' is exercising tunnel health and not port liveness.
 *
 * Why malformed instead of "accept and never reply" or "reset the socket":
 * measured against lib/index.js, both of those make undici retry the request in
 * a tight loop until the 8s UPSTREAM_TIMEOUT_MS abort fires (~17k requests to
 * the proxy). A protocol error is not retried: it fails in ~2ms with 1 request.
 * @param port - loopback port to listen on.
 * @returns the fake proxy's mutable state and a close().
 */
export async function fakeProxy(port) {
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

/**
 * A config field reference shaped like the harness's `Volatile<T>`: a live cell
 * the Loader commits new values into, read at use time.
 * @param initial - the value that stands now.
 * @returns the reference plus a test-only setter standing in for the Loader.
 */
export function volatileRef(initial) {
  let value = initial
  return {
    get: () => value,
    set: (next) => { value = next },
  }
}

/**
 * A stand-in cordis context recording what the plugin registers.
 *
 * `inject` is recorded rather than ignored: the port away from a
 * settings-namespace registration means the plugin must no longer reach for a
 * `settings` service at all, and the test suite asserts that.
 * @returns the fake context plus the recorded state.
 */
export function fakeContext() {
  const listeners = new Map()
  const injected = []
  return {
    listeners,
    injected,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
    on(event, fn) { listeners.set(event, fn) },
    emit(event, ...args) { listeners.get(event)?.(...args) },
    inject(...args) { injected.push(args) },
  }
}

/**
 * Boot the plugin with the 10s probe cadence accelerated to FAST_CADENCE_MS.
 * @param t - the node:test context, used to register cleanup.
 * @param options - the port and probe URL to configure, plus an optional full config override.
 * @returns the captured log lines, the fake context, and transition helpers.
 */
export function boot(t, { port, probeUrl, config }) {
  const lines = []
  const logger = {
    info: (...a) => lines.push(a.map(String).join(' ')),
    warn: (...a) => lines.push(a.map(String).join(' ')),
    error: (...a) => lines.push(a.map(String).join(' ')),
    debug: () => {},
  }
  const ctx = fakeContext()
  ctx.logger = () => logger
  t.after(() => ctx.emit('dispose'))

  const realSetInterval = globalThis.setInterval
  globalThis.setInterval = (fn, ms) => (ms === PROBE_CADENCE_MS ? realSetInterval(fn, FAST_CADENCE_MS) : realSetInterval(fn, ms))
  t.after(() => { globalThis.setInterval = realSetInterval })

  apply(ctx, config ?? {
    enabled: true,
    host: '127.0.0.1',
    port,
    noProxy: ['localhost', '127.0.0.1', '::1', '[::1]'],
    autoReset: true,
    probeUrl,
  })

  return {
    ctx,
    lines,
    transitions: () => lines.filter((line) => line.includes('dsh-proxy: mode ')),
    hasTransition: (needle) => lines.some((line) => line.includes(`dsh-proxy: mode ${needle}`)),
  }
}
