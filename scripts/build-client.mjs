// Bundles the browser half into the inertial CJS factory format the DSH
// client module system expects: window.__ModuleLoader__.load({id, factory}).
// tsc emits lib/client.js as plain ESM for the types; this script overwrites
// it with the loadable bundle. Externals resolve through the module system's
// static table (react) and package rows (@deepseek-ai/dsh-client-runtime).
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const result = await build({
  entryPoints: ['src/client.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  write: false,
  external: ['react', '@deepseek-ai/dsh-client-runtime/client'],
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
