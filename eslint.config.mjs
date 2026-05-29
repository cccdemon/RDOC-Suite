import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Inline globals (the `globals` package isn't a dependency). These cover
// the hand-written browser/service-worker JS under apps/bridge/src/admin/
// static, which otherwise trips no-undef on window/document/fetch/self/etc.
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  location: "readonly",
  history: "readonly",
  fetch: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  queueMicrotask: "readonly",
  alert: "readonly",
  confirm: "readonly",
  prompt: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  FormData: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Headers: "readonly",
  Request: "readonly",
  Response: "readonly",
  EventSource: "readonly",
  WebSocket: "readonly",
  AbortController: "readonly",
  Event: "readonly",
  CustomEvent: "readonly",
  FileReader: "readonly",
  Blob: "readonly",
  btoa: "readonly",
  atob: "readonly",
  HTMLElement: "readonly",
  Node: "readonly",
  CSS: "readonly",
};

const serviceWorkerGlobals = {
  self: "readonly",
  caches: "readonly",
  clients: "readonly",
  skipWaiting: "readonly",
};

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/target/**",
      "**/src-tauri/target/**",
      "**/.vite/**",
      "**/build/**",
      "**/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Treat a leading underscore as "intentionally unused" for both args
    // and locals (e.g. _track, _unused_escape_kept_to_signal_intent).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Hand-written browser + service-worker assets served as-is. Not
    // TypeScript, so no-undef is active — give them the right globals.
    files: ["apps/bridge/src/admin/static/**/*.js"],
    languageOptions: {
      globals: { ...browserGlobals, ...serviceWorkerGlobals },
    },
    // Hand-written browser code: `catch (e) {}` swallow-and-ignore and
    // empty optional-chaining guards are idiomatic here and not worth
    // churning the vendored file over.
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  prettier,
];
