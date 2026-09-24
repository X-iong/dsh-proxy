import Schema from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
/**
 * Why this plugin must run on undici 8, and what breaks on 7.
 *
 * Node's built-in `fetch` does not own its dispatcher: it reads the
 * `Symbol.for('undici.globalDispatcher.1')` slot when a request starts. undici 8
 * keeps that legacy slot working by wrapping whatever is installed in a
 * `Dispatcher1Wrapper`, which bridges the legacy (`.1`) handler built-in `fetch`
 * passes down to the modern (`.2`) handler a current undici dispatcher expects.
 *
 * An undici 7 dispatcher placed in that slot gets no such bridge, and the
 * request never completes: the proxy is never dialled and `fetch()` hangs until
 * its own abort fires. Measured on Node 24.21 with the 0.3.1 build — an undici-7
 * `ProxyAgent` at the slot produced `TimeoutError` with zero requests reaching
 * the proxy, while the same test under undici 8 returned the proxied response.
 * A build like that looks "installed and working": routing decisions, host logs,
 * and the status card all report success while every request keeps going direct.
 *
 * The coupling is on the SLOT, not on an exact version: a dispatcher built by
 * any undici 8 copy (this plugin's own, or the one the harness ships) is
 * compatible, because both write `.1` through the same wrapper.
 */
export declare const name = "dsh-proxy";
export declare const inject: {};
/** Settings namespace this plugin owns; the browser card pairs with it. */
export declare const NS = "dsh-proxy";
/**
 * Resolved, plain configuration — what this plugin actually works with.
 *
 * Callers never hand this around as a live object: `current()` builds a fresh
 * snapshot from the schema's volatile references, so every field it yields is
 * the value that stands at that instant.
 */
export interface ProxyConfig {
    enabled?: boolean;
    host?: string;
    port?: number;
    noProxy?: string[];
    autoReset?: boolean;
    probeUrl?: string;
}
/**
 * The slice of the harness's `Volatile<T>` config reference this plugin reads.
 * Declared structurally so the plugin takes no runtime or type dependency on
 * the shared library that defines it.
 */
export interface VolatileRef<T> {
    /** @returns the current immutable snapshot of the reference. */
    get(): T;
}
/**
 * One field as it arrives on the parsed config: a volatile reference (how the
 * harness always hands config to a plugin) or a plain value (how the tests and
 * a hand-built config call this module).
 */
export type ConfigField<T> = VolatileRef<T> | T | undefined;
/** The parsed config object `apply` receives from the Loader. */
export interface ProxyConfigRaw {
    enabled?: ConfigField<boolean>;
    host?: ConfigField<string>;
    port?: ConfigField<number>;
    noProxy?: ConfigField<string[]>;
    autoReset?: ConfigField<boolean>;
    probeUrl?: ConfigField<string>;
}
/**
 * Read one field, whether it arrived as a volatile reference or plainly.
 *
 * A volatile reference is a live cell the Loader commits new values into
 * without remounting this plugin, so it must be read at use time and never
 * cached; `undefined` from an absent reference falls back to the default.
 */
export declare function readField<T>(field: ConfigField<T>, fallback: T): T;
/**
 * Snapshot the whole config. Every field is volatile, so the result is a plain
 * value that the network layer can hold without observing later edits.
 */
export declare function readConfig(raw: ProxyConfigRaw | undefined): ProxyConfig;
/**
 * Every field is `.volatile()`.
 *
 * The harness exposes exactly the fields its settings form may edit: a field
 * whose schema node is not volatile is ordinary composition configuration, is
 * invisible to the form, and can only change by rewriting the profile patch and
 * restarting the entry. Marking the whole schema volatile is what makes the
 * card on the Plugins page able to write a new host or port that the running
 * plugin picks up immediately — the Loader commits the new value into the
 * reference in place (no remount) and emits `loader/volatile-update`, which is
 * what this plugin listens for.
 */
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    enabled: Schema<boolean, boolean, "volatile-defined">;
    host: Schema<string, string, "volatile-defined">;
    port: Schema<number, number, "volatile-defined">;
    noProxy: Schema<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    autoReset: Schema<boolean, boolean, "volatile-defined">;
    probeUrl: Schema<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: Schema<boolean, boolean, "volatile-defined">;
    host: Schema<string, string, "volatile-defined">;
    port: Schema<number, number, "volatile-defined">;
    noProxy: Schema<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    autoReset: Schema<boolean, boolean, "volatile-defined">;
    probeUrl: Schema<string, string, "volatile-defined">;
}>>, "plain">;
export declare function shouldBypass(rawHost: string, noProxy: readonly string[]): boolean;
/** Compose the http proxy URL from the configured host and port. */
export declare function proxyUrlOf(config: ProxyConfig): string;
/**
 * Whether two config snapshots need a different dispatcher: the endpoint moved
 * (host/port), the bypass list changed, or a behaviour flag flipped.
 *
 * Compared field by field against the schema defaults rather than by object
 * identity, because every read rebuilds the snapshot.
 * @param left - the config the running dispatcher was built from.
 * @param right - the config that stands now.
 * @returns whether the installed dispatcher must be replaced.
 */
export declare function configDiffers(left: ProxyConfig, right: ProxyConfig): boolean;
export declare function apply(ctx: Context, rawConfig: ProxyConfigRaw): void;
declare const _default: {
    name: string;
    inject: {};
    Config: Schema<Schemastery.ObjectS<NoInfer<{
        enabled: Schema<boolean, boolean, "volatile-defined">;
        host: Schema<string, string, "volatile-defined">;
        port: Schema<number, number, "volatile-defined">;
        noProxy: Schema<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
        autoReset: Schema<boolean, boolean, "volatile-defined">;
        probeUrl: Schema<string, string, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: Schema<boolean, boolean, "volatile-defined">;
        host: Schema<string, string, "volatile-defined">;
        port: Schema<number, number, "volatile-defined">;
        noProxy: Schema<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
        autoReset: Schema<boolean, boolean, "volatile-defined">;
        probeUrl: Schema<string, string, "volatile-defined">;
    }>>, "plain">;
    apply: typeof apply;
};
export default _default;
