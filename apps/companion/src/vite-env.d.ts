/// <reference types="vite/client" />

/** Build-time constants injected by vite.config.ts `define`.
 *  Backed by package.json (version) + git (commit count + short hash). */
declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
declare const __APP_HASH__: string;
declare const __APP_BUILT_AT__: string;
