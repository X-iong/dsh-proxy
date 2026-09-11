import Schema from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-proxy";
export declare const inject: {};
/** Settings namespace this plugin owns; the browser card pairs with it. */
export declare const NS = "dsh-proxy";
export interface ProxyConfig {
    enabled?: boolean;
    host?: string;
    port?: number;
    noProxy?: string[];
    autoReset?: boolean;
    probeUrl?: string;
}
export declare const Config: Schema<Schemastery.ObjectS<{
    enabled: Schema<boolean, boolean>;
    host: Schema<string, string>;
    port: Schema<number, number>;
    noProxy: Schema<string[], string[]>;
    autoReset: Schema<boolean, boolean>;
    probeUrl: Schema<string, string>;
}>, Schemastery.ObjectT<{
    enabled: Schema<boolean, boolean>;
    host: Schema<string, string>;
    port: Schema<number, number>;
    noProxy: Schema<string[], string[]>;
    autoReset: Schema<boolean, boolean>;
    probeUrl: Schema<string, string>;
}>>;
export declare function shouldBypass(rawHost: string, noProxy: readonly string[]): boolean;
/** Compose the http proxy URL from the configured host and port. */
export declare function proxyUrlOf(config: ProxyConfig): string;
export declare function apply(ctx: Context, config: ProxyConfig): void;
declare const _default: {
    name: string;
    inject: {};
    Config: Schema<Schemastery.ObjectS<{
        enabled: Schema<boolean, boolean>;
        host: Schema<string, string>;
        port: Schema<number, number>;
        noProxy: Schema<string[], string[]>;
        autoReset: Schema<boolean, boolean>;
        probeUrl: Schema<string, string>;
    }>, Schemastery.ObjectT<{
        enabled: Schema<boolean, boolean>;
        host: Schema<string, string>;
        port: Schema<number, number>;
        noProxy: Schema<string[], string[]>;
        autoReset: Schema<boolean, boolean>;
        probeUrl: Schema<string, string>;
    }>>;
    apply: typeof apply;
};
export default _default;
