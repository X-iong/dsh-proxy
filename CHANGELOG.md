# 更新日志

版本与 harness 的配对关系见 [README「兼容性」](README.md#兼容性先看这一节)。
简言之：**0.3.2 / 0.3.3 面向 harness 0.1.7-rc.2 及以上；0.3.0 / 0.3.1 面向 0.1.7-rc.1；0.2.x 面向 0.1.6 及更早**，不可混用。

## 0.3.3 — 2026-09-24

文档与配置卡文案去 Clash 化。功能零变化，只为不再让非 Clash 用户以为自己不适用。

- 起因：一台用**脉动**（不是 Clash）的机器实测通过——插件状态 `routing: proxy`、`tunnel: ok`，且 `curl --proxy http://127.0.0.1:7892 https://api.ipify.org` 返回节点出口 IP。这证明插件的实际要求只是「一个支持 HTTP 代理（含 HTTPS `CONNECT`）的端口」，与客户端品牌无关。
- 配置卡上直接显示的字段描述改为厂商中立：`host`「例如 127.0.0.1（你的代理客户端监听的本机地址）」、`port`「你的代理客户端提供的 HTTP 代理端口」；此前写的是「Clash/mihomo 混合端口」。
- README / README_EN：首段与「为什么需要它」不再把 Clash 当默认前提；安装一节明确各家默认端口不同（脉动 7892、Clash/mihomo 混合端口 7890），以客户端界面显示的「HTTP 代理端口」为准；常见问题里的「Clash 系统代理」「Clash TUN 模式」改为面向任意客户端；SOCKS5 一条不再暗示只有 Clash 可行。
- README 里那段「粘给 Agent 代为安装」的提示词不再假定 7890，改为先确认客户端与实际端口。
- `package.json` 的 `description` 同步为厂商中立。

## 0.3.2 — 2026-09-24

**破坏性**：适配 DeepSeek Harness **0.1.7-rc.2**。0.3.1 装到 rc.2 上**看起来完全正常**，实际一条请求都不走代理——这是本次修复的核心。

- **宿主半改用 undici 8**（`undici: ^7.0.0` → `^8.10.0`，与 harness 自带的 `dsh-http-proxy` 同一条依赖线）。
  Node 内置 `fetch` 只认 `Symbol.for('undici.globalDispatcher.1')` 这个插槽，而 undici 8 会把装进该插槽的 dispatcher 包一层 `Dispatcher1Wrapper`，把内置 fetch 传下来的 `.1` handler 桥接成当前 undici 期望的 `.2` handler。undici 7 的 dispatcher 拿不到这层桥接：**请求发到 dispatcher 之后永远不完成**，代理端口一次都不会被拨号，`fetch()` 一直挂到自己的 abort 超时。Node 24.21 实测：把 undici 7 的 `ProxyAgent` 放在该插槽上 → 代理收到 0 个请求、`fetch` 抛 `TimeoutError`；同一测试换成 undici 8 → 正常拿到代理应答。
  症状的欺骗性在于：路由判定、宿主日志、配置卡状态全部照常上报「走代理」，只有真实流量还在直连。
- **错误拦截改用 `.2` handler 契约**（`onResponseError(controller, error)`，同时兼容旧的 `onError(error)`）。
  此前只拦 `onError`，而 undici 8 经 `Dispatcher1Wrapper` 递下来的是 `LegacyHandlerWrapper`——**它根本没有 `onError` 方法**，于是这个 hook 静默失效：线上传输故障不再被观测，连接池不重建，模型报错也不会被改写成中文提示。
- **错误拦截的转发方式改为「取值 + bind」**（原为 `Object.create` 原型委托）。
  `LegacyHandlerWrapper` 的方法内部读 `#handler` 私有字段，经派生对象调用会以错误的 receiver 读该私有字段，请求直接死于 `Cannot read private member #handler from an object whose class did not declare it`，用户只看到一个笼统的 `fetch failed`。
- **`paceDials` 加防御，并把节流上移到 dispatch 层**：`clientFactory` 的 `connect` 在 undici 8 上不再总是函数，缺失时原样放行（否则请求时抛 `connect is not a function`）。但仅放行会让「防重拨风暴」这一保护**静默失效**——它原本包的就是那个 connector。undici 8 改为在 `ProxyAgent` 内部自建 `Http1ProxyWrapper`/`Agent`，connector 不再外露，因此新增 `PaceProxyDials`：在进入代理连接池的那一层把调用按 400ms 间隔排队（窗口开着且队列为空时立即放行，所以单条正常请求不受影响；实测单条 25ms、三条并发间隔 407/406/405ms）。
- **测试补上真正能发现这个 bug 的一层**：新增 `test/global-fetch.test.mjs` 与 `test/pacing.test.mjs`，前者用**真实 `fetch` + 本地绝对形式代理**断言流量落点，后者按生产探测节奏断言节流。此前 `proxy.test.mjs` 读的是 `getGlobalDispatcher()`（`.2` 插槽），插件写不写都能通过，所以 0.3.1 全绿却完全失效。已 A/B 验证：把 handler 包装换回 0.3.1 写法，线上故障观测会失败；把 undici 换回 7，真实 fetch 会挂死。
- 依赖与元数据对齐当前 harness：`@deepseek-ai/dsh-client-ui-primitives` 的 peer/dev 由 `0.1.7-rc.1` → `0.1.7-rc.2`（该 peer 参与 harness 的 `evaluatePluginCompatibility` 校验，pin 旧版本会让 profile 直接拒绝加载该 bundle），`engines.dsh` → `>=0.1.7-rc.2`、`engines.node` → `>=22.19`。

### 从 0.3.1 升级

装新版并重启 DSH 即可，配置无需改动。升级后请**用一个必须经代理的 API 提供方点一次「获取可用模型」实测**——0.3.1 的失效表现正是「哪都对，就是不生效」。

## 0.3.1 — 2026-09-24

0.3.0 之后落地的三处修复：功能不变，行为更正确。

- **配置卡只注册 `plugins.bundle.config`**（`18fe6bd`）。
  此前同时注册了行级槽位 `plugins.row.config`，导致同一个配置表单在「包页面」和「该包的行的页面」各出现一次，用起来像 bug。该 bundle 唯一的那个「行」就是插件自身，行级槽位不提供任何额外能力。同 harness 上其他第三方 bundle（dsh-univer-office、dsh-context）也只注册包级槽位。
- **补注册 `plugins.bundle.config`**（`66ecf84`）。
  修复「插件列表里点 dsh-proxy 只有开关、没有任何配置项」：插件管理页的包详情页渲染配置区块的条件是 `configured ? <section>… : null`，而 `configured` 就是「该包名在 `plugins.bundle.config` 里有没有 occupant」——没人注册时连区块标题都不渲染。
- **`/dsh-proxy/status` 路由随插件卸载释放**（`84c865f`）。
  `WebServer.register` 不跟 fiber 绑定、只返回一个 disposer，重复注册同一路径会抛错。原先丢弃了那个 disposer，导致路由泄漏、插件**下次重载**会抛 `webserver: duplicate exact route`（首次挂载完全正常，所以症状具有欺骗性）。

## 0.3.0 — 2026-09-24

**破坏性**：适配 DeepSeek Harness **0.1.7-rc.1**，与 0.2.x 不兼容。

harness 0.1.7 换掉了整套插件配置机制，因此两半都重写了：

- **宿主半**：删掉已移除的 `SettingsProvider.installSection`；插件的可编辑配置改为读自身 Loader entry 的 volatile 引用（`Config` 每个字段加 `.volatile()`，否则字段在表单里根本不出现且无报错），并订阅 `loader/volatile-update` 做热更新；另在存活探测上加配置漂移兜底，事件没到也不会丢改动。
- **浏览器半**：`settingsScope` 服务已不存在 → 改用 `configForms`；配置卡改用官方 `SettingsFormModel` / `SettingsForm` / `SettingsValueField`（删掉自绘 CSS 与手写表单控制器），入口迁到插件管理页的包级配置槽位。
- 其余接口未变，原样保留：`webServer.register`、`llm/stream` waterfall、`dispose` 生命周期。
- 顺带修复：`tsconfig.json` 的 include 只写了 `src/**/*.ts`，**`src/client.tsx` 此前从未被类型检查过**——正是这次坏掉的那一半。

## 0.2.8 及更早

面向 harness ≤ 0.1.6（含 0.1.5-rc.2）的实现，代码保留在 tag [`v0.2.8`](https://github.com/X-iong/dsh-proxy/tree/v0.2.8)。
