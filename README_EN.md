# dsh-proxy

English | [简体中文](README.md)

**Custom HTTP/HTTPS proxy for DeepSeek Harness** — route every host-side fetch (LLM requests, model discovery, plugin market, web search) through your proxy (Clash / mihomo / v2ray), **without TUN mode** and without relying on the OS system proxy.

## Compatibility (read this first)

| Plugin version | Harness it targets |
|---|---|
| **0.3.x** | **0.1.7-rc.1 and newer** |
| 0.2.x | 0.1.5-rc.2 and older (0.2.8 is the last one, kept on the `v0.2.8` tag) |

Harness 0.1.7 replaced the plugin-configuration mechanism: a plugin no longer registers a settings namespace of its own — the framework **derives the configuration form from the plugin's exported `Config` schema**, and only exposes fields marked `.volatile()`. The browser-side settings service also changed from `settingsScope` to `configForms`, and the configuration entry point moved from Settings → Built-in plugins to the sidebar **Plugins** panel. 0.3.0 is therefore a **breaking adaptation**; the two lines cannot be mixed:

- `0.3.x` on harness 0.1.6 or older: no card appears and nothing is configurable.
- `0.2.x` on harness 0.1.7-rc.1: the host half throws `installSection is not a function`, and the card never appears.

## Why

DSH Desktop / Web sends LLM requests from a host Node process via the global `fetch` (undici):

- **Ignores the system proxy**: Windows proxy settings and Clash's "system proxy" toggle have no effect on it.
- **Ignores proxy env vars**: `HTTPS_PROXY` and friends do not affect Node's global fetch.
- **No built-in proxy setting**: neither DSH Settings nor provider profiles expose one.

So when an API endpoint is blocked by Cloudflare per-IP (common for residential IP ranges), or you simply must egress through a proxy, TUN mode used to be the only answer. This plugin offers another: **swap the global fetch dispatcher for a `ProxyAgent` inside the host process**. All requests egress through your proxy, and Clash's rule mode keeps doing the routing (domestic direct, foreign proxied) — no conflict.

## Before / After

| Before (blocked by Cloudflare per-IP, 403) | After (model list loads) |
|---|---|
| ![Before: fetching models answers 403](docs/images/before-403.png) | ![After: model list fetched successfully](docs/images/after-success.png) |

## How it works

The plugin runs in the same host Node process as DSH's LLM adapter. On load it:

1. Saves the current global dispatcher;
2. Builds a routed dispatcher backed by undici's `ProxyAgent` with a bypass list, and installs it via `setGlobalDispatcher`;
3. From then on, **every** global fetch in the process (model discovery `GET /models`, OpenAI SDK chat requests, plugin market, web search, …) egresses through the proxy;
4. Unloading the plugin, or turning the switch off on the configuration card, restores the previous dispatcher — no restart needed.

The bypass list (`noProxy`) defaults to `localhost`, `127.0.0.1`, `::1`, so loopback requests always go direct.

The plugin also runs two probes continuously and exposes their verdict to the card:

- **Port liveness** (every 10 s): is anything listening on the proxy port? This is the *only* input to the proxy/direct routing decision — no listener (you turned the VPN off) means direct.
- **End-to-end tunnel probe**: one real `CONNECT` + TLS handshake + HTTP request. A broken tunnel **never** moves traffic to direct on its own; it only tells you — on the card and in the host log, in Chinese — whether the node is down and what to do about it.

## Install

```powershell
# Web deployment (dsh web)
dsh plugin --profile web add github:X-iong/dsh-proxy

# DSH Desktop
dsh plugin --profile desktop add github:X-iong/dsh-proxy
```

Restart DSH afterwards (`dsh web` for the web deployment, the app for Desktop). The plugin starts enabled on `127.0.0.1:7890` (Clash/mihomo mixed port).

> You can also paste this prompt into a DSH conversation and let the Agent install it for you:
>
> ```text
> Please install and enable the dsh-proxy plugin (a custom HTTP proxy plugin for DeepSeek Harness):
> 1. Check my harness version first: dsh --version. Below 0.1.7-rc.1, use the v0.2.8 tag; otherwise use main.
> 2. Run: dsh plugin --profile web add github:X-iong/dsh-proxy
>    (Use desktop instead of web for DSH Desktop. If it fails with ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED,
>     copy the full allowBuilds key from the error into that profile's pnpm-workspace.yaml and retry.)
> 3. Remind me to restart DSH so the plugin loads.
> 4. After restart the proxy defaults to 127.0.0.1:7890. If my proxy differs, open the sidebar Plugins panel,
>    go to the dsh-proxy bundle, and click Configure on the dsh-proxy row; saving applies immediately.
> 5. Verify with a provider that needs the proxy (click "Fetch available models").
> ```

## Configuration

**Where: sidebar **Plugins** panel → the `dsh-proxy` bundle → its page → click Configure on the `dsh-proxy` row.**

(Harness 0.1.7 moved plugin configuration pages here; Settings → Built-in plugins is now a read-only inventory.)

Saving applies immediately, with no restart: every field this plugin declares is volatile, so the harness commits new values **in place** into the running plugin and notifies it through the `loader/volatile-update` event, which makes it re-decide routing at once.

| Field | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch. Off restores direct connections without uninstalling. |
| `host` | `127.0.0.1` | Proxy server host. |
| `port` | `7890` | Proxy server port (1–65535). |
| `noProxy` | `localhost, 127.0.0.1, ::1, [::1]` | Bypass list: exact hostnames; leading `.` matches domain suffixes (e.g. `.lan`); `*` bypasses everything. |
| `autoReset` | `true` | Rebuild the connection pool after a transport-layer error so a dead pooled connection is never reused. |
| `probeUrl` | `https://api.deepseek.com/models` | Tunnel probe target; the plugin really requests it to decide whether the upstream tunnel works. |

The card also shows the host's read-only verdict: whether traffic currently goes **through the proxy** or **direct**, whether the tunnel is healthy, and since when it has not been.

Values land in the `config` section of this plugin's row in the active profile's `cordis.patch.yml` (harness 0.1.7 no longer uses `~/.dsh/settings.yaml`). HTTP proxies only; for SOCKS5 use Clash/mihomo's mixed port.

> ⚠️ The mount id is **meaningful** — do not change it: `dsh-proxy` is simultaneously the configuration namespace, the entry id the browser half addresses, and half of the configuration card's registration key (`dsh-proxy#dsh-proxy`). Mounting under another id still installs the proxy, but the card will not appear (the host half logs that case explicitly).

## Verify

1. Make sure Clash/mihomo is running with mixed port 7890;
2. Open a provider that needs the proxy and click **Fetch available models**;
3. A populated model list means success. On failure, check the `dsh-proxy` lines in the host log — the `dsh web` console for a web deployment, `%APPDATA%\DSH Desktop\logs\` for Desktop.

## Platform support

- **Windows 10/11**: primary development and test platform.
- **macOS / Linux**: the plugin is pure Node network-layer code and platform-independent; it works wherever DSH runs (field reports welcome).

## FAQ

**Q: Clash system proxy is on — why does DSH still connect directly?**
A: The system proxy only affects apps that honor it (browsers, etc.). DSH's LLM requests are made with undici fetch inside a Node host process, which ignores the system proxy — exactly why this plugin exists.

**Q: Does it conflict with Clash TUN mode?**
A: No. Use either one; running both is also fine (requests enter Clash via the proxy port and rules still apply).

**Q: Does it affect the plugin market and web search?**
A: Yes — every global fetch in the process goes through the proxy. Under Clash rule mode that is the desired behavior: domestic sites stay direct.

**Q: SOCKS5?**
A: Not supported. undici's ProxyAgent only accepts HTTP/HTTPS proxies. Clash/mihomo's mixed port speaks HTTP — use that.

**Q: The configuration card disappeared after I upgraded my harness?**
A: Check the version pairing first (see Compatibility above). Harness 0.1.7-rc.1 needs plugin 0.3.x; on 0.2.x the host log reports `installSection is not a function`.

## Development

```powershell
pnpm install
pnpm build       # tsc -> lib/ plus the bundled browser half lib/client.js
pnpm test        # node --test test/
pnpm typecheck   # tsc --noEmit
# Live test against a real proxy:
$env:DSH_PROXY_LIVE='1'; pnpm test
```

Development dependencies install the real `@deepseek-ai/*` 0.1.7-rc.1 packages for type checking, and `src/client.tsx` is in `tsconfig.json`'s include list, so the browser half is type-checked too.

## License

[MIT](LICENSE)
