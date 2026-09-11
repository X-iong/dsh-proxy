window.__ModuleLoader__.load({
	id: "dsh-proxy",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  default: () => client_default,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var React = __toESM(require("react"), 1);
function createSnapshotStore(initial) {
  let value = initial;
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => value,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    set: (next) => {
      value = next;
      for (const fn of listeners) fn();
    }
  };
}
var { createElement: h } = React;
var NS = "dsh-proxy";
var CSS_TAG = "dsh-proxy/ProxyCard.module.css";
var CSS = `
.dsh-proxy-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary)}
.dsh-proxy-card h3{margin:0;font-size:14px;font-weight:600}
.dsh-proxy-card .desc{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsh-proxy-field{display:flex;flex-direction:column;gap:4px}
.dsh-proxy-field label{font-size:12px;font-weight:500}
.dsh-proxy-field input{font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-background-primary);color:inherit}
.dsh-proxy-field input[data-invalid=true]{border-color:var(--dsw-alias-state-danger,#d33)}
.dsh-proxy-field .hint{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsh-proxy-row{display:flex;gap:10px;align-items:flex-start}
.dsh-proxy-row .grow{flex:1}
.dsh-proxy-toggle{display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer}
.dsh-proxy-actions{display:flex;gap:8px;justify-content:flex-end;align-items:center}
.dsh-proxy-actions button{font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-background-primary);color:inherit;cursor:pointer}
.dsh-proxy-actions button[data-primary=true]{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}
.dsh-proxy-actions button:disabled{opacity:.5;cursor:default}
.dsh-proxy-status{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-right:auto}
.dsh-proxy-trigger{display:flex;align-items:center;gap:6px;font:inherit;font-size:13px;padding:6px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-background-primary);color:inherit;cursor:pointer;line-height:1}
.dsh-proxy-trigger:hover{background:var(--dsw-alias-background-secondary,#00000014)}
.dsh-proxy-trigger[data-active=true]{border-color:var(--dsw-alias-state-business-primary)}
.dsh-proxy-trigger-icon{font-size:14px;line-height:1}
.dsh-proxy-overlay{position:fixed;left:16px;bottom:64px;z-index:1000;pointer-events:auto;width:340px;max-width:calc(100vw - 32px)}
.dsh-proxy-overlay-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid var(--dsw-alias-border-l2);border-bottom:none;border-radius:8px 8px 0 0;background:var(--dsw-alias-background-primary)}
.dsh-proxy-overlay-header .t{margin:0;font-size:13px;font-weight:600}
.dsh-proxy-overlay-header button{font:inherit;font-size:12px;padding:3px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.dsh-proxy-overlay .dsh-proxy-card{border-radius:0 0 8px 8px;max-width:none}
`;
function ensureCss() {
  if (typeof document === "undefined") return;
  if (document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`) !== null) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-proxy";
  tag.dataset.pluginCss = CSS_TAG;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
function numberField(field) {
  return {
    field,
    format: (value) => typeof value === "number" ? String(value) : "",
    parse: (text) => {
      const trimmed = String(text).trim();
      if (trimmed === "") return { kind: "clear" };
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? { kind: "set", value: parsed } : void 0;
    }
  };
}
function textField(field) {
  return {
    field,
    format: (value) => typeof value === "string" ? value : "",
    parse: (text) => {
      const trimmed = String(text).trim();
      return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
    }
  };
}
function booleanField(field) {
  return {
    field,
    format: (value) => Boolean(value),
    parse: (value) => ({ kind: "set", value: Boolean(value) })
  };
}
var ProxyCardController = class {
  scope;
  specs;
  staged = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  saving = false;
  failed = false;
  constructor(scope) {
    this.scope = scope;
    this.specs = /* @__PURE__ */ new Map([
      ["enabled", booleanField("enabled")],
      ["host", textField("host")],
      ["port", numberField("port")]
    ]);
    scope.subscribe(() => this.publish());
  }
  bind(project) {
    const store = createSnapshotStore(project());
    this.listeners.add(() => store.set(project()));
    return store;
  }
  publish() {
    for (const listener of this.listeners) listener();
  }
  sectionValue(field) {
    const snapshot = this.scope.getSnapshot();
    const section = snapshot.status === "ready" ? snapshot.value : void 0;
    return section?.[field];
  }
  baseValue(field) {
    const snapshot = this.scope.getSnapshot();
    const base = snapshot.status === "ready" ? snapshot.base : void 0;
    return base?.[field];
  }
  stored(field) {
    const snapshot = this.scope.getSnapshot();
    const user = snapshot.status === "ready" ? snapshot.user : void 0;
    return user !== void 0 && Object.prototype.hasOwnProperty.call(user, field);
  }
  shell() {
    const snapshot = this.scope.getSnapshot();
    const plan = this.plan();
    return {
      available: snapshot.status === "ready",
      writable: snapshot.status === "ready" && snapshot.writable !== false,
      dirty: plan.length > 0,
      invalid: plan.some((item) => item.run === void 0),
      saving: this.saving,
      failed: this.failed
    };
  }
  field(field) {
    const spec = this.specs.get(field);
    const staged = this.staged.get(field);
    if (staged === void 0) {
      return { value: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false };
    }
    const write = spec.parse(staged.value);
    return { value: staged.value, overridden: write?.kind === "set", invalid: write === void 0 };
  }
  plan() {
    const items = [];
    for (const [field, staged] of this.staged) {
      const spec = this.specs.get(field);
      items.push({ field, run: spec.parse(staged.value) });
    }
    return items;
  }
  actions() {
    return {
      edit: (field, value) => {
        this.staged.set(field, { value });
        this.publish();
      },
      resetField: (field) => {
        this.staged.set(field, { value: this.specs.get(field).format(this.baseValue(field)) });
        this.publish();
      },
      save: () => {
        void this.save();
      },
      discard: () => {
        this.staged.clear();
        this.failed = false;
        this.publish();
      }
    };
  }
  async save() {
    if (this.saving) return;
    const plan = this.plan();
    if (plan.some((item) => item.run === void 0)) return;
    this.saving = true;
    this.failed = false;
    this.publish();
    try {
      for (const item of plan) {
        if (item.run.kind === "clear") await this.scope.unset(item.field);
        else await this.scope.set(item.field, item.run.value);
      }
      this.staged.clear();
    } catch {
      this.failed = true;
    } finally {
      this.saving = false;
      this.publish();
    }
  }
  inject() {
    return { hooks: { proxyCard: this.bind(() => this.projection()) }, ...this.actions() };
  }
  projection() {
    return {
      ...this.shell(),
      enabled: this.field("enabled"),
      host: this.field("host"),
      port: this.field("port")
    };
  }
};
function Field(props) {
  return h("div", { className: "dsh-proxy-field" }, [
    h("label", { key: "label", htmlFor: props.id }, props.label),
    h("input", {
      key: "input",
      id: props.id,
      type: "text",
      value: props.value,
      placeholder: props.placeholder ?? "",
      disabled: props.disabled,
      "data-invalid": props.invalid ? true : void 0,
      onChange: (event) => props.onEdit(event.target.value)
    }),
    h("p", { key: "hint", className: "hint" }, props.invalid ? props.invalidLabel : props.hint)
  ]);
}
function ProxyCard(props) {
  ensureCss();
  const state = props.useProxyCard((snapshot) => snapshot);
  const disabled = !state.writable || state.saving;
  return h("div", { className: "dsh-proxy-card" }, [
    h("h3", { key: "title" }, "dsh-proxy"),
    h(
      "p",
      { key: "desc", className: "desc" },
      "\u81EA\u5B9A\u4E49 HTTP \u4EE3\u7406\uFF1A\u8BA9 DSH \u5BBF\u4E3B\u8FDB\u7A0B\u7684\u5168\u90E8 fetch\uFF08LLM \u8BF7\u6C42\u3001\u6A21\u578B\u53D1\u73B0\u3001\u5E02\u573A\u3001web \u641C\u7D22\uFF09\u7ECF\u4EE3\u7406\u51FA\u7AD9\u3002\u4FDD\u5B58\u540E\u5373\u65F6\u751F\u6548\uFF0C\u65E0\u9700\u91CD\u542F\u3002"
    ),
    h("label", { key: "enabled", className: "dsh-proxy-toggle" }, [
      h("input", {
        key: "box",
        type: "checkbox",
        checked: Boolean(state.enabled.value),
        disabled,
        onChange: (event) => props.edit("enabled", event.target.checked)
      }),
      "\u542F\u7528\u4EE3\u7406"
    ]),
    h("div", { key: "fields", className: "dsh-proxy-row" }, [
      h(
        "div",
        { key: "host", className: "grow" },
        h(Field, {
          id: "dsh-proxy-host",
          label: "\u4EE3\u7406\u5730\u5740",
          hint: "\u4EE3\u7406\u670D\u52A1\u5668\u5730\u5740\uFF0C\u4F8B\u5982 127.0.0.1",
          invalidLabel: "\u65E0\u6548\u5730\u5740",
          value: state.host.value,
          invalid: state.host.invalid,
          disabled,
          onEdit: (text) => props.edit("host", text)
        })
      ),
      h(
        "div",
        { key: "port", style: { width: "120px" } },
        h(Field, {
          id: "dsh-proxy-port",
          label: "\u7AEF\u53E3",
          hint: "\u4F8B\u5982 7890",
          invalidLabel: "\u65E0\u6548\u7AEF\u53E3",
          value: state.port.value,
          invalid: state.port.invalid,
          disabled,
          onEdit: (text) => props.edit("port", text)
        })
      )
    ]),
    h("div", { key: "actions", className: "dsh-proxy-actions" }, [
      h(
        "span",
        { key: "status", className: "dsh-proxy-status" },
        state.failed ? "\u4FDD\u5B58\u88AB\u62D2\u7EDD\uFF0C\u8BF7\u68C0\u67E5\u503C\u540E\u91CD\u8BD5" : state.dirty ? "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539" : ""
      ),
      h(
        "button",
        { key: "discard", type: "button", disabled: !state.dirty || state.saving, onClick: props.discard },
        "\u653E\u5F03"
      ),
      h(
        "button",
        {
          key: "save",
          type: "button",
          "data-primary": true,
          disabled: !state.dirty || state.invalid || state.saving,
          onClick: props.save
        },
        state.saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"
      )
    ])
  ]);
}
var openState = false;
var openListeners = /* @__PURE__ */ new Set();
var openStore = {
  get: () => openState,
  set: (v) => {
    openState = v;
    openListeners.forEach((l) => l());
  },
  subscribe: (l) => {
    openListeners.add(l);
    return () => {
      openListeners.delete(l);
    };
  }
};
function useOpen() {
  const [, force] = React.useState(0);
  React.useEffect(() => openStore.subscribe(() => force((x) => x + 1)), []);
  return openStore.get();
}
function FooterTrigger(props) {
  ensureCss();
  const open = useOpen();
  const wide = props.wide !== false;
  return h("button", {
    type: "button",
    className: "dsh-proxy-trigger",
    "data-active": open ? true : void 0,
    title: "dsh-proxy",
    "aria-label": "dsh-proxy",
    onClick: () => openStore.set(!open)
  }, [
    h("span", { key: "icon", className: "dsh-proxy-trigger-icon" }, "\u{1F310}"),
    wide ? h("span", { key: "label" }, "dsh-proxy") : null
  ]);
}
function OverlayPanel(props) {
  ensureCss();
  const open = useOpen();
  if (!open) return null;
  return h("div", { className: "dsh-proxy-overlay" }, [
    h("div", { key: "header", className: "dsh-proxy-overlay-header" }, [
      h("span", { key: "t", className: "t" }, "dsh-proxy \u7BA1\u7406"),
      h("button", { key: "close", type: "button", onClick: () => openStore.set(false) }, "\u5173\u95ED")
    ]),
    h(ProxyCard, props)
  ]);
}
var name = "dsh-proxy-client";
var inject = ["settingsScope", "slots"];
function apply(ctx) {
  const controller = new ProxyCardController(ctx.settingsScope.bind({ namespace: NS }));
  ctx.slots.inject("settings.plugin.item", function* () {
    yield ctx.slots.register(
      {
        name: "settings.plugin.item",
        key: NS,
        inject: () => controller.inject()
      },
      ProxyCard
    );
  });
  ctx.slots.inject("sidebar.footer.action", function* () {
    yield ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "dsh-proxy",
        order: 0,
        label: "dsh-proxy"
      },
      FooterTrigger
    );
  });
  ctx.slots.inject("shell.overlay", function* () {
    yield ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-proxy-panel",
        order: 10,
        inject: () => controller.inject()
      },
      OverlayPanel
    );
  });
}
var client_default = { name, inject, apply };

		return module.exports;
	}
});
