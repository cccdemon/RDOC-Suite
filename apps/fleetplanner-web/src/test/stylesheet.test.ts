import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Handoff §11 and §12. jsdom does not lay anything out and does not evaluate a
// media query, so these cannot be rendering assertions. What they can do is stop
// a rule from being deleted or quietly defeated — which is how all three of
// these went missing in the first place.
//
// Read the file, do not import it: vitest stubs CSS imports to an empty module.
// The two node signatures come from node-shim.d.ts.
const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** Everything inside `@media (prefers-reduced-motion: reduce) { … }`. */
function reducedMotionBlock(): string {
  const at = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
  if (at < 0) return "";
  const open = CSS.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return CSS.slice(open + 1, i);
  }
  return "";
}

describe("motion is a preference (§12)", () => {
  it("the stylesheet answers prefers-reduced-motion at all", () => {
    expect(reducedMotionBlock()).not.toBe("");
  });

  it("neutralises both transitions and animations, not just one of them", () => {
    const block = reducedMotionBlock();
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });

  it("leaves animations firing their events instead of removing them", () => {
    // `animation: none` would skip animationend, and anything waiting on it
    // would hang. A near-zero duration still completes.
    const block = reducedMotionBlock();
    expect(block).not.toMatch(/animation:\s*none/);
  });
});

describe("touch targets (§11)", () => {
  it("control height lives in the stylesheet, where a media query can raise it", () => {
    // An inline minHeight beats any rule, so a component-level height would make
    // the phone breakpoint below unreachable.
    expect(CSS).toMatch(/:where\(button, \[role="tab"\], \[role="button"\]\)\s*\{\s*min-height:\s*38px/);
  });

  it("raises the target to 44px on touch-sized viewports", () => {
    const at = CSS.indexOf("@media (max-width: 760px)", CSS.indexOf("min-height: 38px"));
    expect(at).toBeGreaterThan(-1);
    expect(CSS.slice(at, at + 300)).toContain("min-height: 44px");
  });

  it("the shared button tokens do not pin their own height", () => {
    const ui = readFileSync(resolve(process.cwd(), "src/components/ui.tsx"), "utf8");
    const base = /const btnBase: CSSProperties = \{[^}]*\}/.exec(ui)?.[0] ?? "";
    expect(base).not.toBe("");
    expect(base).not.toContain("minHeight");
  });
});

describe("the management navigation on a phone (§11)", () => {
  it("scrolls the two rows sideways instead of wrapping them into a wall", () => {
    // Four areas plus up to five sub-views wrapped into two or three stacked
    // rows before any content started.
    expect(CSS).toContain(".fpw-manage-areas");
    expect(CSS).toContain(".fpw-manage-tabs");
    const at = CSS.indexOf(".fpw-manage-areas");
    const block = CSS.slice(at, at + 700);
    expect(block).toContain("flex-wrap: nowrap");
    expect(block).toContain("overflow-x: auto");
  });

  it("shows that a cut-off row continues", () => {
    // A row that simply ends at the edge reads as a row that ended.
    const at = CSS.indexOf(".fpw-manage-areas");
    expect(CSS.slice(at, at + 700)).toContain("mask-image");
  });
});
