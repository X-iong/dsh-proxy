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
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var PKG = "dsh-proxy";
var NS = "dsh-proxy";
var LOCALE_NS = "dshProxy";
var STATUS_POLL_MS = 3e3;
var STATUS_PATH = "/dsh-proxy/status";
var zh = {
  description: "\u81EA\u5B9A\u4E49 HTTP \u4EE3\u7406\uFF1A\u8BA9 DSH \u5BBF\u4E3B\u8FDB\u7A0B\u7684\u5168\u90E8 fetch\uFF08LLM \u8BF7\u6C42\u3001\u6A21\u578B\u53D1\u73B0\u3001\u5E02\u573A\u3001web \u641C\u7D22\uFF09\u7ECF\u4EE3\u7406\u51FA\u7AD9\u3002",
  enabled: "\u542F\u7528\u4EE3\u7406",
  host: "\u4EE3\u7406\u5730\u5740",
  hostHint: "\u4EE3\u7406\u670D\u52A1\u5668\u5730\u5740\uFF0C\u4F8B\u5982 127.0.0.1",
  port: "\u7AEF\u53E3",
  portHint: "\u4F8B\u5982 7890",
  overridden: "\u5DF2\u8986\u76D6",
  reset: "\u6062\u590D\u9ED8\u8BA4",
  invalidHost: "\u65E0\u6548\u5730\u5740",
  invalidPort: "\u65E0\u6548\u7AEF\u53E3",
  unavailable: "\u8BE5\u63D2\u4EF6\u5F53\u524D\u672A\u52A0\u8F7D\uFF0C\u6682\u65F6\u65E0\u6CD5\u914D\u7F6E\u3002",
  readOnly: "\u672C\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002",
  save: "\u4FDD\u5B58",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  saveFailed: "\u672C\u90E8\u7F72\u6CA1\u6709\u63A5\u53D7\u8FD9\u4E9B\u503C\uFF0C\u5DF2\u4FDD\u7559\u4F9B\u4F60\u4FEE\u6539\u3002",
  statusUnreadable: "\u5BBF\u4E3B\u72B6\u6001\uFF1A\u6682\u4E0D\u53EF\u8BFB",
  routing: "\u8DEF\u7531\uFF1A{state}",
  routingProxy: "\u8D70\u4EE3\u7406",
  routingDirect: "\u76F4\u8FDE\uFF08\u4EE3\u7406\u7AEF\u53E3\u4E0D\u53EF\u8FBE\uFF09",
  routingDisabled: "\u672A\u542F\u7528",
  routingStarting: "\u6B63\u5728\u5224\u5B9A\u2026",
  routingUnknown: "\u672A\u77E5",
  tunnelOk: "\u96A7\u9053\uFF1A\u6B63\u5E38",
  tunnelBroken: "\u96A7\u9053\u5F02\u5E38\uFF1A\u4EE3\u7406\u8282\u70B9\u4E0D\u53EF\u8FBE\uFF08{at} \u8D77\uFF09\u3002\u8BF7\u5207\u6362\u8282\u70B9\uFF0C\u6216\u5173\u95ED\u4EE3\u7406\u6539\u8D70\u76F4\u8FDE\u3002"
};
var en = {
  description: "Custom HTTP proxy: routes every host-side fetch (LLM requests, model discovery, market, web search) through your proxy.",
  enabled: "Enable proxy",
  host: "Proxy host",
  hostHint: "Proxy server address, for example 127.0.0.1",
  port: "Port",
  portHint: "For example 7890",
  overridden: "Overridden",
  reset: "Reset to default",
  invalidHost: "Not a valid address",
  invalidPort: "Not a valid port",
  unavailable: "This plugin is not loaded, so it cannot be configured right now.",
  readOnly: "This deployment stores settings read-only.",
  save: "Save",
  saving: "Saving\u2026",
  saveFailed: "The deployment did not accept these values; they were left for you to correct.",
  statusUnreadable: "Host status: not readable right now",
  routing: "Routing: {state}",
  routingProxy: "through the proxy",
  routingDirect: "direct (proxy port unreachable)",
  routingDisabled: "not enabled",
  routingStarting: "deciding\u2026",
  routingUnknown: "unknown",
  tunnelOk: "Tunnel: healthy",
  tunnelBroken: "Tunnel broken: the proxy node is unreachable (since {at}). Switch nodes, or turn the proxy off to go direct."
};
function settingsBooleanField(field) {
  return {
    field,
    format: (value) => value === true ? "true" : "false",
    parse: (text) => text === "true" || text === "false" ? { kind: "set", value: text === "true" } : void 0
  };
}
var ProxyCardController = class {
  form;
  store;
  /** @param scope - the shared config form for this plugin's entry id. */
  constructor(scope) {
    this.form = new import_dsh_client_ui_primitives.SettingsFormModel(scope, [
      settingsBooleanField("enabled"),
      (0, import_dsh_client_ui_primitives.settingsTextField)("host"),
      (0, import_dsh_client_ui_primitives.settingsNumberField)("port")
    ]);
    this.store = this.form.bind(() => this.projection());
  }
  projection() {
    return {
      ...this.form.shell(),
      enabled: this.form.field("enabled"),
      host: this.form.field("host"),
      port: this.form.field("port")
    };
  }
  /**
   * The business face the slot registration injects: the snapshot the component
   * selects from, the form's edit/save actions, and the bound translate.
   * @param t - the card's bound translate function.
   * @returns the inject face.
   */
  inject(t) {
    return {
      hooks: { proxyCard: this.store },
      ...this.form.actions(),
      t
    };
  }
  /** Release the accepted-value subscription. */
  dispose() {
    this.form.dispose();
  }
};
function useRuntimeStatus() {
  const [status, setStatus] = React.useState(void 0);
  React.useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const response = await fetch(STATUS_PATH, { cache: "no-store" });
        if (!live) return;
        setStatus(response.ok ? await response.json() : void 0);
      } catch {
        if (live) setStatus(void 0);
      }
    };
    void read();
    const id = setInterval(() => {
      void read();
    }, STATUS_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return status;
}
function statusLines(status, t) {
  if (status === void 0) return [{ warn: false, text: t("statusUnreadable") }];
  const routing = String(status.routing ?? "");
  const routingText = routing === "proxy" ? t("routingProxy") : routing === "direct" ? t("routingDirect") : routing === "disabled" ? t("routingDisabled") : routing === "starting" ? t("routingStarting") : t("routingUnknown");
  const lines = [{ warn: false, text: t("routing", { state: routingText }) }];
  if (status.tunnel === "broken") {
    const at = typeof status.tunnelBrokenAt === "number" ? new Date(status.tunnelBrokenAt).toLocaleTimeString() : t("routingStarting");
    lines.push({ warn: true, text: t("tunnelBroken", { at }) });
  } else {
    lines.push({ warn: false, text: t("tunnelOk") });
  }
  return lines;
}
var STATUS_STYLE = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--dsw-alias-label-tertiary)"
};
var STATUS_WARN_STYLE = { ...STATUS_STYLE, color: "var(--dsw-alias-label-error)" };
var TOGGLE_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 0",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--dsw-alias-label-primary)",
  cursor: "pointer"
};
function ProxyCard(props) {
  const { t } = props;
  const state = props.useProxyCard((snapshot) => snapshot);
  const status = useRuntimeStatus();
  if (props.view === "summary") return t("description");
  const disabled = !state.writable;
  return React.createElement(import_dsh_client_ui_primitives.SettingsForm, {
    labels: {
      unavailable: t("unavailable"),
      readOnly: t("readOnly"),
      saveFailed: t("saveFailed"),
      save: t("save"),
      saving: t("saving")
    },
    state,
    onSave: props.save,
    onDiscard: props.discard,
    children: [
      React.createElement(
        "div",
        { key: "status" },
        statusLines(status, t).map(
          (line, index) => React.createElement("p", {
            key: index,
            style: line.warn ? STATUS_WARN_STYLE : STATUS_STYLE
          }, line.text)
        )
      ),
      React.createElement("label", { key: "enabled", style: TOGGLE_STYLE }, [
        React.createElement("input", {
          key: "box",
          type: "checkbox",
          checked: state.enabled.text === "true",
          disabled,
          onChange: (event) => {
            props.edit("enabled", event.target.checked ? "true" : "false");
          }
        }),
        t("enabled")
      ]),
      React.createElement(import_dsh_client_ui_primitives.SettingsValueField, {
        key: "host",
        id: "dsh-proxy-host",
        label: t("host"),
        hint: t("hostHint"),
        invalidLabel: t("invalidHost"),
        overriddenLabel: t("overridden"),
        resetLabel: t("reset"),
        disabled,
        text: state.host.text,
        overridden: state.host.overridden,
        invalid: state.host.invalid,
        onEdit: (text) => {
          props.edit("host", text);
        },
        onReset: () => {
          props.resetField("host");
        }
      }),
      React.createElement(import_dsh_client_ui_primitives.SettingsValueField, {
        key: "port",
        id: "dsh-proxy-port",
        label: t("port"),
        hint: t("portHint"),
        invalidLabel: t("invalidPort"),
        overriddenLabel: t("overridden"),
        resetLabel: t("reset"),
        disabled,
        numeric: true,
        text: state.port.text,
        overridden: state.port.overridden,
        invalid: state.port.invalid,
        onEdit: (text) => {
          props.edit("port", text);
        },
        onReset: () => {
          props.resetField("port");
        }
      })
    ]
  });
}
var name = "dsh-proxy-client";
var inject = ["slots", "configForms", "locale"];
function apply(ctx) {
  const t = ctx.locale.bind(LOCALE_NS);
  ctx.effect(() => ctx.locale.register(LOCALE_NS, "zh", zh), "dsh-proxy: Chinese dictionary");
  ctx.effect(() => ctx.locale.register(LOCALE_NS, "en", en), "dsh-proxy: English dictionary");
  const card = new ProxyCardController(ctx.configForms.get(NS));
  ctx.effect(() => () => {
    card.dispose();
  }, "dsh-proxy: settings form subscription");
  ctx.effect(
    () => ctx.configForms.whileServed([NS], () => {
      const disposeBundle = ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
        name: "plugins.bundle.config",
        key: PKG,
        inject: () => card.inject(t)
      }, ProxyCard));
      const disposeRow = ctx.slots.inject("plugins.row.config", () => ctx.slots.register({
        name: "plugins.row.config",
        key: `${PKG}#${NS}`,
        inject: () => card.inject(t)
      }, ProxyCard));
      return () => {
        disposeBundle();
        disposeRow();
      };
    }),
    "dsh-proxy: configuration card"
  );
}
var client_default = { name, inject, apply };

		return module.exports;
	}
});
