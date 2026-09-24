// Bundles the browser half into the inertial CJS factory format the DSH client
// module system expects: window.__ModuleLoader__.load({id, factory}).
//
// `id` must be the graph row's id, which is the npm package name — that is how
// the web shell's module table looks the bundle up.
//
// tsc emits lib/client.js as plain ESM for the declarations; this script
// overwrites it with the loadable bundle.
//
// Externals: both specifiers this half requires are part of the client module
// table's BASELINE seed, which the web shell builds before Cordis exists
// (react, react/jsx-runtime, react-dom, @deepseek-ai/cordis,
// @deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
// @deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit).
// Nothing here needs a `dsh.client.external` declaration.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const result = await build({
  entryPoints: ['src/client.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  write: false,
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
  logLevel: 'warning',
})

const code = result.outputFiles[0].text
const wrapped = `window.__ModuleLoader__.load({
\tid: "dsh-proxy",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${code}
\t\treturn module.exports;
\t}
});
`
writeFileSync('lib/client.js', wrapped)
console.log(`lib/client.js bundled (${wrapped.length} bytes)`)
