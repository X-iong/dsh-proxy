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
export declare function apply(ctx: ClientContext): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
