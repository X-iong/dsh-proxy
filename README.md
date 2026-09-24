# dsh-proxy

[English](README_EN.md) | 简体中文

**为 DeepSeek Harness 注入自定义 HTTP 代理** —— 让 DSH 宿主进程的全部 fetch 流量（LLM 请求、模型发现、插件市场、web 搜索）走你指定的代理（Clash / mihomo / v2ray 等），**无需开启 TUN 模式**，也不依赖系统代理。

## 兼容性（先看这一节）

| 插件版本 | 适配的 harness |
|---|---|
| **0.3.2** | **0.1.7-rc.2 及以上** |
| 0.3.0 / 0.3.1 | 0.1.7-rc.1 |
| 0.2.x | 0.1.5-rc.2 及更早（0.2.8 是最后一个，保留在 `v0.2.8` tag） |

**务必按这一栏配对，尤其是 0.3.1 → 0.3.2 这一档。** 0.3.1 装到 0.1.7-rc.2 上不会报任何错：插件正常挂载、日志照常打印「routing through it」、配置卡状态也显示走代理，但**实际一条请求都不走代理**。原因是 Node 内置 `fetch` 与 undici 之间的插槽契约变了，见下面「工作原理」一节的说明；0.3.2 修掉了它。

判断自己是不是踩了这个坑：升级到 0.3.2 之前，只要「日志说走代理、但某个本该被 Cloudflare 拦的端点仍然 403 / 仍然直连」，就是它。

0.1.7 把插件配置机制整体换了：插件不再自己注册设置命名空间，而是**由框架从插件导出的 `Config` schema 直接生成配置表单**，且只暴露标了 `.volatile()` 的字段；浏览器侧的设置服务也由 `settingsScope` 换成了 `configForms`，配置入口从「设置 → 内置插件」搬到了侧边栏的「插件」面板。因此 0.3.0 是一次**破坏性适配**，不能与 0.2.x 混用：

- 装 `0.3.2` 到 0.1.7-rc.1 或更早的 harness 上：卡片不出现、配置改不动（undici 插槽契约不匹配）。
- 装 `0.2.x` 到 0.1.7-rc.1 上：宿主侧会抛 `installSection is not a function`，卡片永不出现。

0.3.2 另修了一处**不报错的**失效：宿主半从 undici 7 换到 undici 8。Node 内置 `fetch` 取 dispatcher 走的是 `Symbol.for('undici.globalDispatcher.1')` 这个跨版本插槽，undici 8 会把装进去的 dispatcher 包一层 `Dispatcher1Wrapper`（把内置 fetch 传下来的 `.1` handler 桥接成 `.2` handler），而 undici 7 的 dispatcher 没有这层桥接，结果是请求发下去之后永不完成、代理端口一次都不被拨号。同一份源码在 0.1.7-rc.1 上能用、在 0.1.7-rc.2 上静默失效，差别就在这里。

## 为什么需要它

DSH 桌面端 / Web 端的 LLM 请求由宿主 Node 进程发出，走的是 Node 全局 `fetch`（undici）：

- **不读系统代理**：Windows 设置里的代理、Clash 的"系统代理"开关对它无效。
- **不读代理环境变量**：`HTTPS_PROXY` 等环境变量对 Node 全局 fetch 无效。
- **没有内置代理设置**：DSH 的设置界面与提供方配置里都没有代理选项。

于是当某个 API 端点被 Cloudflare 按 IP 拦截（国内宽带段很常见）、或你必须经代理才能访问时，唯一的选择曾是 Clash 的 TUN 模式。本插件提供了另一条路：**在宿主进程内把全局 fetch 的 dispatcher 换成 ProxyAgent**，所有请求经你的代理出站，由 Clash 的规则模式继续负责分流（国内直连、国外走节点），互不冲突。

## 效果对比

| 使用前（被 Cloudflare 按 IP 拦截，403） | 使用后（正常拉出模型列表） |
|---|---|
| ![使用前：获取模型返回 403](docs/images/before-403.png) | ![使用后：成功获取模型列表](docs/images/after-success.png) |

## 工作原理

插件与 DSH 的 LLM 适配器运行在同一个宿主 Node 进程中。加载时：

1. 保存当前全局 dispatcher；
2. 用 `undici` 的 `ProxyAgent` 构造一个带绕过名单的路由 dispatcher，并通过 `setGlobalDispatcher` 安装；
3. 之后进程内**所有**全局 fetch（模型发现 `GET /models`、OpenAI SDK 聊天请求、插件市场、web 搜索等）都经代理出站；
4. 卸载插件、或在配置卡里关闭开关，即恢复原来的 dispatcher，无需重启。

绕过名单（`noProxy`）默认包含 `localhost`、`127.0.0.1`、`::1`，本地回环请求永远直连。

> **为什么宿主半必须用 undici 8**：Node 内置 `fetch` 不持有自己的 dispatcher，它在每次请求开始时读 `Symbol.for('undici.globalDispatcher.1')` 这个插槽。undici 8 会把装进该插槽的 dispatcher 包一层 `Dispatcher1Wrapper`，把内置 fetch 传下来的旧式（`.1`）handler 桥接成当前 undici 期望的新式（`.2`）handler；undici 7 的 dispatcher 没有这层桥接，请求会在发到 dispatcher 之后永不完成（代理端口一次都不被拨号）。这个耦合在**插槽**上而不是具体版本号上——插件自带的 undici 8 与 harness 自带的 undici 8 都能写通同一个插槽。

插件还会持续做两项探测，并把结论暴露给配置卡：

- **端口存活探测**（10 秒一次）：代理端口是否在监听。只有它决定"走代理 / 直连"——端口不在（比如你关了 VPN）就走直连。
- **隧道端到端探测**：真发一次 `CONNECT` + TLS + HTTP 请求，判断代理上游隧道是否可用。**隧道坏了不会自动改走直连**，只在卡片和宿主日志里用中文告诉你是节点挂了、该换节点还是关代理。

## 安装

```powershell
# Web 部署（dsh web）
dsh plugin --profile web add github:X-iong/dsh-proxy

# DSH Desktop
dsh plugin --profile desktop add github:X-iong/dsh-proxy
```

装完需要重启 DSH（Web 端重启 `dsh web`，桌面端重启应用）。插件默认启用 `127.0.0.1:7890`（Clash/mihomo 混合端口）。

> 也可以把下面这段提示词直接粘贴到 DSH 对话里，让 Agent 代为安装配置：
>
> ```text
> 请帮我安装并启用 dsh-proxy 插件（DeepSeek Harness 的自定义 HTTP 代理插件）。步骤：
> 1. 先确认我的 harness 版本：dsh --version。低于 0.1.7-rc.1 用 v0.2.8 tag，0.1.7-rc.1 用 v0.3.1 tag，0.1.7-rc.2 及以上用 main。
> 2. 执行：dsh plugin --profile web add github:X-iong/dsh-proxy
>    （桌面端把 web 换成 desktop。若提示 ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED，
>     按报错提示把完整的 allowBuilds 键加入对应 profile 的 pnpm-workspace.yaml 后重试。）
> 3. 安装完成后提醒我重启 DSH 使插件生效。
> 4. 重启后插件默认代理 127.0.0.1:7890；地址或端口不同的话，在侧边栏「插件」面板里
>    找到 dsh-proxy 这个 bundle，进它的页面，在 dsh-proxy 那一行点「配置」修改，保存即生效、无需重启。
> 5. 用一个需要代理的 API 提供方（点"获取可用模型"）验证是否成功。
> ```

## 配置

**入口：侧边栏「插件」面板 → 找到 `dsh-proxy` 这个 bundle → 进它的页面 → `dsh-proxy` 那一行点「配置」。**

（0.1.7 把插件配置页从「设置 → 内置插件」移到了这里；「设置 → 内置插件」那个页面现在只剩只读的插件清单。）

保存即时生效、无需重启：插件声明的每个字段都是 volatile 的，harness 会把新值**原地提交**进正在运行的插件，并通过 `loader/volatile-update` 事件通知它立刻重新判定路由。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关。关闭即恢复直连，无需卸载。 |
| `host` | `127.0.0.1` | 代理服务器地址。 |
| `port` | `7890` | 代理服务器端口（1–65535）。 |
| `noProxy` | `localhost, 127.0.0.1, ::1, [::1]` | 绕过名单：精确匹配主机名；以 `.` 开头匹配域名后缀（如 `.lan`）；`*` 表示全部直连。 |
| `autoReset` | `true` | 自动重建连接池：检测到传输层错误时销毁并重建连接池，避免复用失效连接。 |
| `probeUrl` | `https://api.deepseek.com/models` | 隧道探测目标；插件定期用这个地址真发一次请求来判断上游隧道是否可用。 |

配置卡上还会显示宿主侧的只读状态：当前是**走代理**还是**直连**、隧道是否正常、以及隧道异常是从什么时候开始的。

配置值最终落在当前 profile 的 `cordis.patch.yml` 里这一行的 `config` 段（0.1.7 起 harness 不再使用 `~/.dsh/settings.yaml`）。仅支持 HTTP 代理；SOCKS5 用户请使用 Clash/mihomo 的混合端口。

> ⚠️ 挂载 id 是**有语义的**，不要改：`dsh-proxy` 同时是插件配置的命名空间、浏览器半寻址的 entry id、以及配置卡注册键 `dsh-proxy#dsh-proxy` 的一半。换成别的 id 代理照样工作，但配置卡不会出现（宿主侧日志会明确提示这一点）。

## 验证

1. 确认 Clash/mihomo 正在运行且混合端口为 7890；
2. 打开一个需要代理才能访问的 API 提供方配置页，点 **获取可用模型**；
3. 能拉出模型列表即成功。失败时看宿主日志里 `dsh-proxy` 的行；Web 端是 `dsh web` 的控制台输出，桌面端在 `%APPDATA%\DSH Desktop\logs\` 下当天日志里。

## 平台支持

- **Windows 10/11**：主要开发与测试平台。
- **macOS / Linux**：插件本身是纯 Node 网络层代码，与平台无关；任何运行 DSH 的平台均可使用（欢迎反馈实测结果）。

## 常见问题

**Q: 开了 Clash 系统代理，为什么 DSH 还是直连？**
A: 系统代理只对遵循它的应用有效（浏览器等）。DSH 的 LLM 请求在 Node 宿主进程里用 undici fetch 发出，不读系统代理——这正是本插件存在的原因。

**Q: 和 Clash TUN 模式冲突吗？**
A: 不冲突。两者任选其一即可；同时开也没问题（请求会经代理端口再进 Clash，规则分流依然生效）。

**Q: 会影响插件市场、web 搜索吗？**
A: 会——进程内所有全局 fetch 都走代理。在 Clash 规则模式下这正是期望行为：国内站点依然直连。

**Q: 支持 SOCKS5 吗？**
A: 不支持。undici 的 ProxyAgent 只接受 HTTP/HTTPS 代理。Clash/mihomo 的混合端口同时提供 HTTP 代理能力，填它即可。

**Q: 升级 harness 后配置卡不见了？**
A: 先核对版本配对（见开头「兼容性」）。0.1.7-rc.1 需要插件 0.3.0/0.3.1；0.1.7-rc.2 需要 0.3.2。若装的是 0.2.x，宿主日志里会有 `installSection is not a function`。

**Q: 日志说「routing through it」，但请求还是直连 / 还是 403？**
A: 这是 0.3.1 装到 harness 0.1.7-rc.2 上的典型症状（宿主半的 undici 版本与该插槽契约不匹配，见「工作原理」）。升到 0.3.2 即可；升级后请用一个必须经代理的 API 提供方点一次「获取可用模型」实测。

## 开发

```powershell
pnpm install
pnpm build       # tsc -> lib/ + 打包浏览器半 lib/client.js
pnpm test        # node --test test/
pnpm typecheck   # tsc --noEmit
# 带真实代理的 live 测试：
$env:DSH_PROXY_LIVE='1'; pnpm test
```

开发依赖直接安装真实的 `@deepseek-ai/*` 0.1.7-rc.2 包做类型检查；`src/client.tsx` 也在 `tsconfig.json` 的 include 里，所以浏览器半同样会被 `tsc` 检查。

测试里 `test/global-fetch.test.mjs` 是**唯一能发现宿主半静默失效**的那一层：它用真实 `fetch` 打一个本地绝对形式代理，断言请求确实落在代理上（另外还覆盖绕过名单、线上故障观测、以及内置 fetch 实际读取的 `undici.globalDispatcher.1` 插槽）。`test/pacing.test.mjs` 则按生产探测节奏验证进入代理池的调用仍被 400ms 节流。改动宿主半的网络层后请务必都跑。

## License

[MIT](LICENSE)
