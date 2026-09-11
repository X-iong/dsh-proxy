interface ScopeSnapshot {
    status: string;
    value?: Record<string, any>;
    base?: Record<string, any>;
    user?: Record<string, any>;
    writable?: boolean;
}
interface SettingsScope {
    getSnapshot(): ScopeSnapshot;
    subscribe(listener: () => void): unknown;
    set(field: string, value: unknown): Promise<void>;
    unset(field: string): Promise<void>;
}
export declare const name = "dsh-proxy-client";
/** Required services (cordis fiber inject) — service names, not package names. */
export declare const inject: string[];
interface ClientContext {
    settingsScope: {
        bind(spec: {
            namespace: string;
        }): SettingsScope;
    };
    slots: {
        inject(name: string, callback: () => Iterable<unknown>): unknown;
        register(entry: Record<string, unknown>, component: unknown): unknown;
    };
}
/**
 * The card is the plugin's only UI surface: it is contributed to the Plugins
 * settings section and owns its own disclosure, exactly like the built-in
 * plugin cards. There is deliberately no separate sidebar entry or floating
 * panel — a second copy of the same form was only a way to get to the first.
 */
export declare function apply(ctx: ClientContext): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
