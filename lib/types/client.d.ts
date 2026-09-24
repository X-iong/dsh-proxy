import { type SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives';
/** Translate function bound to this card's locale namespace. */
type Translate = (key: string, params?: Record<string, unknown>) => string;
/** The shared config form for one namespace, as `ctx.configForms.get(id)` returns it. */
type ConfigFormLike<T> = SettingsFormScope<T>;
/** The slot registry members this half calls. */
interface SlotsService {
    /**
     * Install an effect for each declaration lifetime of a slot: the callback runs
     * as soon as the slot is declared, or immediately when it already is.
     */
    inject(key: string, callback: () => () => void): () => void;
    /** Contribute a component to a declared slot. */
    register(options: Record<string, unknown>, component: unknown): () => void;
}
/** The settings forms service members this half calls. */
interface ConfigFormsService {
    /** Get the shared form for one Host plugin entry id. */
    get<T>(entryId: string): ConfigFormLike<T>;
    /** Keep a registration alive while the Host serves any of some namespaces. */
    whileServed(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void): () => void;
}
/** The locale service members this half calls. */
interface LocaleService {
    /** Register one namespace's dictionary for one locale. */
    register(ns: string, locale: string, dict: Record<string, string>): () => void;
    /** Bind a namespace to a translate function reading the active locale at call time. */
    bind(ns: string): Translate;
}
/**
 * The client services this browser half uses.
 *
 * Declared structurally with the official contracts as the source of truth —
 * `slots` is the renderer's `SlotRegistry`, `configForms` is the settings
 * domain's `ConfigForms`, `locale` is `LocaleRuntime` — naming only the members
 * this half calls, so the plugin keeps no type dependency on packages it does
 * not ship with.
 */
interface ClientContext {
    slots: SlotsService;
    configForms: ConfigFormsService;
    locale: LocaleService;
    /** Run a disposer-returning effect on this plugin's fiber. */
    effect(callback: () => unknown, label?: string): unknown;
}
export declare const name = "dsh-proxy-client";
/**
 * Required services (cordis fiber inject).
 *
 * Note that this is the CLIENT half's own declaration, separate from
 * `package.json.dsh.client.inject` — that field is an informational list of
 * package-name edges for the boot graph and carries no service meaning.
 */
export declare const inject: string[];
/**
 * Mount the configuration card.
 *
 * Registration is gated twice, deliberately: `whileServed` keeps the card absent
 * until the Host actually serves this plugin's entry (so a deployment that never
 * mounted it shows no trace), and `slots.inject` keeps it absent until the
 * Plugins page declares the slot (registering into an undeclared slot throws).
 * @param ctx - the browser plugin context.
 */
export declare function apply(ctx: ClientContext): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
