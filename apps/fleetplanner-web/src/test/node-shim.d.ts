// The SPA's tsconfig carries `types: ["vite/client"]` and nothing else, on
// purpose: application code should not be able to reach for a node API by
// accident. One test needs to read the stylesheet from disk, so it gets exactly
// the two signatures it uses rather than all of @types/node.
//
// If a second test ever needs more of node, that is the moment to reconsider
// this file — not the moment to keep extending it.

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
  export function resolve(...parts: string[]): string;
}

declare const process: { cwd(): string };
