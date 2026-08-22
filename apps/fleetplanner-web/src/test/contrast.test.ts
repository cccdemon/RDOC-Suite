import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Read from disk, not imported: vitest stubs CSS imports to an empty module and
// `?raw` does not survive that. The two node signatures this needs are declared
// in node-shim.d.ts so the browser package keeps its narrow type surface.
const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

// Handoff §10.2: "Textkontrast WCAG AA anstreben".
//
// The secondary text ramp was mixed towards the background, which put --dim2 at
// 2.68:1 and --dim3 at 2.03:1 on a card — and those two carry most of the
// explanatory copy in the product. Contrast is not something you can eyeball on
// a dark theme, so it is measured here instead of remembered.
//
// The test reads the stylesheet rather than a copy of the values: a token that
// gets darkened again fails here, not in somebody's eyes.

/** The two surfaces text actually sits on. */
const SURFACES = {
  "page (--bg)": "#121416",
  "card (--card)": "#2b3135",
};

/** Tokens that carry text a user is expected to read. */
const TEXT_TOKENS = ["--text", "--text-hi", "--dim", "--dim2", "--dim3"];

function hexOf(token: string): string {
  // Only literal hex is checkable here; color-mix() would need a browser to
  // resolve. --text and --text-hi are allowed to stay computed, so they are
  // pinned by their source colours instead.
  const literal = new RegExp(`\\${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(CSS);
  if (literal) return literal[1];
  const known: Record<string, string> = {
    // --text: color-mix(offwhite 84%, space); --text-hi: offwhite
    "--text": "#cececd",
    "--text-hi": "#f2f2f0",
  };
  const k = known[token];
  if (!k) throw new Error(`${token} is neither a literal hex nor a known computed value`);
  return k;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("text contrast (§10.2)", () => {
  it("the brand surfaces are what the ratios were measured against", () => {
    expect(CSS).toContain("--rdoc-space: #121416");
    expect(CSS).toContain("--rdoc-graphite: #2b3135");
  });

  for (const token of TEXT_TOKENS) {
    for (const [surface, bg] of Object.entries(SURFACES)) {
      it(`${token} reaches AA body text on the ${surface}`, () => {
        const ratio = contrast(hexOf(token), bg);
        // 4.5:1 is the AA threshold for normal-size text. These tokens are used
        // at 0.7–0.9rem, so the large-text exemption does not apply to them.
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("keeps three distinguishable steps rather than collapsing into one grey", () => {
    const [dim, dim2, dim3] = ["--dim", "--dim2", "--dim3"].map((t) => luminance(hexOf(t)));
    // Readable is not enough — the ramp has to still express hierarchy.
    expect(dim).toBeGreaterThan(dim2);
    expect(dim2).toBeGreaterThan(dim3);
  });
});
