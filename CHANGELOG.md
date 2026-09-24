# 更新日志

版本与 harness 的配对关系见 [README「兼容性」](README.md#兼容性先看这一节)。
简言之：**0.3.x 面向 harness 0.1.7-rc.1 及以上；0.2.x 面向 0.1.6 及更早**，两者不可混用。

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
