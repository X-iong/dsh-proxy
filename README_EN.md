# dsh-proxy

English | [简体中文](README.md)

**Custom HTTP/HTTPS proxy for DeepSeek Harness** — route every host-side fetch (LLM requests, model discovery, plugin market, web search) through your proxy (Clash / mihomo / v2ray), **without TUN mode** and without relying on the OS system proxy.

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
4. Unloading the plugin or flipping the switch in Settings restores the previous dispatcher — no restart needed.

The bypass list (`noProxy`) defaults to `localhost`, `127.0.0.1`, `::1`, so loopback requests always go direct.

## Install

### Option 1: paste this prompt into a DSH conversation (recommended)

Copy the whole block below and send it to your DSH Agent — it will install and configure the plugin for you:

```text
Please install and enable the dsh-proxy plugin (a custom HTTP proxy plugin for DeepSeek Harness):
1. Run: dsh plugin --profile desktop add github:BuLongY/dsh-proxy
   (DSH Desktop uses the desktop profile; for a pure web deployment use web instead.
    If it fails with "another plugin install recovery transaction is pending",
    rename %APPDATA%\DSH Desktop\plugin-install-recovery\state.json to state.json.bak and retry.
    If you hit ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED, copy the full allowBuilds key from the error
    into %UserProfile%\.dsh\profiles\desktop\pnpm-workspace.yaml and retry.)
2. Remind me to restart DSH Desktop so the plugin loads.
3. After restart the proxy defaults to 127.0.0.1:7890 (Clash mixed port).
   If my proxy uses a different host or port, edit it in Settings → Plugins → Plugin configuration → dsh-proxy; saving applies immediately, no restart.
4. Verify with a provider that needs the proxy (click "Fetch available models").
```

### Option 2: manual CLI install

```powershell
dsh plugin --profile desktop add github:BuLongY/dsh-proxy
```

Then **restart DSH Desktop**. The proxy defaults to `127.0.0.1:7890` (Clash/mihomo mixed port).

Once published to npm, `dsh plugin --profile desktop add dsh-proxy` also works (no build-allowance step).

## Configuration

After install, edit in **Settings → Plugins → Plugin configuration → dsh-proxy** (saving applies immediately, no restart):

| Field | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch. Off restores direct connections without uninstalling. |
| `host` | `127.0.0.1` | Proxy server host. |
| `port` | `7890` | Proxy server port (1–65535). |
| `noProxy` | `localhost, 127.0.0.1, ::1, [::1]` | Bypass list: exact hostnames; leading `.` matches domain suffixes (e.g. `.lan`); `*` bypasses everything. |

You can also edit the `dsh-proxy` section in `%UserProfile%\.dsh\settings.yaml` directly. HTTP proxies only; for SOCKS5 use Clash/mihomo's mixed port.

## Verify

1. Make sure Clash/mihomo is running with mixed port 7890;
2. Open a provider that needs the proxy and click **Fetch available models**;
3. A populated model list means success. On failure, check the `dsh-proxy` lines in today's log under `%APPDATA%\DSH Desktop\logs\`.

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

## Development

```powershell
npm install
npm run build      # tsc -> lib/
npm test           # node --test test/
# Live test against a real proxy:
$env:DSH_PROXY_LIVE='1'; npm test
```

## License

[MIT](LICENSE)
