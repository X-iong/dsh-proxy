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
var CSS_TAG = "dsh-proxy/ProxyCard.module.css?v2";
var CSS = `
.dsh-proxy-card{list-style:none;border:0.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}
.dsh-proxy-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-proxy-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dsh-proxy-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.dsh-proxy-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-proxy-headtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-proxy-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-proxy-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-proxy-pending{flex:none;border:0.5px solid var(--dsw-alias-border-l4);border-radius:999px;padding:1px 8px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.dsh-proxy-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dsh-proxy-chevron-open{transform:rotate(180deg)}
.dsh-proxy-body{border-top:0.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dsh-proxy-readonly{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-proxy-toggle{display:flex;align-items:center;gap:8px;padding:12px 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-proxy-toggle input{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.dsh-proxy-row{display:flex;gap:12px;padding:12px 0 0;border-top:0.5px solid var(--dsw-alias-border-l2)}
.dsh-proxy-row .grow{flex:1;min-width:0}
.dsh-proxy-field{display:flex;flex-direction:column;gap:6px}
.dsh-proxy-field-head{display:flex;align-items:center;gap:8px}
.dsh-proxy-field-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-proxy-field-reset{border:none;background:none;padding:0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-proxy-field-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.dsh-proxy-field-reset:disabled{cursor:default;opacity:.4}
.dsh-proxy-input{height:34px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);width:100%;box-sizing:border-box}
.dsh-proxy-input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dsh-proxy-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dsh-proxy-input-invalid{border-color:var(--dsw-alias-label-error)}
.dsh-proxy-invalid{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}
.dsh-proxy-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-proxy-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:0.5px solid var(--dsw-alias-border-l2)}
.dsh-proxy-failed{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}
.dsh-proxy-discard,.dsh-proxy-save{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.dsh-proxy-discard{border-color:var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary)}
.dsh-proxy-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dsh-proxy-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsh-proxy-discard:disabled,.dsh-proxy-save:disabled{opacity:.4;cursor:default}
.dsh-proxy-discard:focus-visible,.dsh-proxy-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
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
var CHEVRON_PATH = "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732C6.59876 8.24849C6.74023 8.3623C6.87291 8.46904C6.92272 8.47813C6.9375 8.48047C6.97895 8.48703C7.02105 8.48703C7.0625 8.48047C7.07728 8.47813C7.12709 8.46904C7.25977 8.3623C7.40124 8.24849C7.57405 8.07732C7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z";
function Chevron(props) {
  return h(
    "svg",
    {
      className: props.open ? "dsh-proxy-chevron dsh-proxy-chevron-open" : "dsh-proxy-chevron",
      width: 14,
      height: 14,
      viewBox: "0 0 14 14",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": true,
      focusable: false
    },
    h("path", { d: CHEVRON_PATH, fill: "currentColor" })
  );
}
function Field(props) {
  return h("div", { className: "dsh-proxy-field" }, [
    h("div", { key: "head", className: "dsh-proxy-field-head" }, [
      h("label", { key: "label", className: "dsh-proxy-field-label", htmlFor: props.id }, props.label),
      props.overridden ? h(
        "button",
        { key: "reset", type: "button", className: "dsh-proxy-field-reset", disabled: props.disabled, onClick: props.onReset },
        "\u91CD\u7F6E"
      ) : null
    ]),
    h("input", {
      key: "input",
      id: props.id,
      type: "text",
      className: props.invalid ? "dsh-proxy-input dsh-proxy-input-invalid" : "dsh-proxy-input",
      value: props.value,
      placeholder: props.placeholder ?? "",
      disabled: props.disabled,
      onChange: (event) => props.onEdit(event.target.value)
    }),
    h(
      "p",
      { key: "hint", className: props.invalid ? "dsh-proxy-invalid" : "dsh-proxy-hint" },
      props.invalid ? props.invalidLabel : props.hint
    )
  ]);
}
function ProxyCard(props) {
  ensureCss();
  const [open, setOpen] = React.useState(false);
  const saveStarted = React.useRef(false);
  const state = props.useProxyCard((snapshot) => snapshot);
  React.useEffect(() => {
    if (state.saving) {
      saveStarted.current = true;
      return;
    }
    if (!saveStarted.current) return;
    saveStarted.current = false;
    if (!state.dirty && !state.failed) setOpen(false);
  }, [state.dirty, state.failed, state.saving]);
  const disabled = !state.writable || state.saving;
  const blocked = !state.dirty || state.invalid || state.saving;
  return h("li", { className: open ? "dsh-proxy-card dsh-proxy-card-open" : "dsh-proxy-card" }, [
    h(
      "button",
      {
        key: "header",
        type: "button",
        className: "dsh-proxy-header",
        "aria-expanded": open,
        "aria-label": `${open ? "\u6536\u8D77" : "\u5C55\u5F00"}: dsh-proxy`,
        onClick: () => setOpen(!open)
      },
      [
        h("span", { key: "text", className: "dsh-proxy-headtext" }, [
          h("span", { key: "name", className: "dsh-proxy-name" }, "dsh-proxy"),
          h(
            "span",
            { key: "desc", className: "dsh-proxy-desc" },
            "\u81EA\u5B9A\u4E49 HTTP \u4EE3\u7406\uFF1A\u8BA9 DSH \u5BBF\u4E3B\u8FDB\u7A0B\u7684\u5168\u90E8 fetch\uFF08LLM \u8BF7\u6C42\u3001\u6A21\u578B\u53D1\u73B0\u3001\u5E02\u573A\u3001web \u641C\u7D22\uFF09\u7ECF\u4EE3\u7406\u51FA\u7AD9\u3002"
          )
        ]),
        state.dirty ? h("span", { key: "pending", className: "dsh-proxy-pending" }, "\u672A\u4FDD\u5B58") : null,
        h(Chevron, { key: "chevron", open })
      ]
    ),
    open ? h("div", { key: "body", className: "dsh-proxy-body" }, [
      !state.available ? h("p", { key: "ro", className: "dsh-proxy-readonly", role: "status" }, "\u8BBE\u7F6E\u5C1A\u672A\u5C31\u7EEA\uFF0C\u6682\u65F6\u53EA\u8BFB\u3002") : null,
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
            overridden: state.host.overridden,
            disabled,
            onEdit: (text) => props.edit("host", text),
            onReset: () => props.resetField("host")
          })
        ),
        h(
          "div",
          { key: "port", style: { width: "160px", flex: "none" } },
          h(Field, {
            id: "dsh-proxy-port",
            label: "\u7AEF\u53E3",
            hint: "\u4F8B\u5982 7890",
            invalidLabel: "\u65E0\u6548\u7AEF\u53E3",
            value: state.port.value,
            invalid: state.port.invalid,
            overridden: state.port.overridden,
            disabled,
            onEdit: (text) => props.edit("port", text),
            onReset: () => props.resetField("port")
          })
        )
      ]),
      h("div", { key: "footer", className: "dsh-proxy-footer" }, [
        state.failed ? h("p", { key: "failed", className: "dsh-proxy-failed", role: "status" }, "\u4FDD\u5B58\u88AB\u62D2\u7EDD\uFF0C\u8BF7\u68C0\u67E5\u503C\u540E\u91CD\u8BD5") : null,
        h(
          "button",
          { key: "discard", type: "button", className: "dsh-proxy-discard", disabled: !state.dirty || state.saving, onClick: props.discard },
          "\u653E\u5F03"
        ),
        h(
          "button",
          { key: "save", type: "button", className: "dsh-proxy-save", disabled: blocked, onClick: props.save },
          state.saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"
        )
      ])
    ]) : null
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
}
var client_default = { name, inject, apply };

		return module.exports;
	}
});
