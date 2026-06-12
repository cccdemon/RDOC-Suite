import { describe, expect, it } from "vitest";

import { escape, html, rawHtml, renderMarkdown, safe } from "../../web/render.js";

describe("html renderer", () => {
  it("escapes untrusted scalar values", () => {
    expect(escape(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
    );
  });

  it("auto-escapes template values but preserves safe html", () => {
    const rendered = html`<p>${"<b>unsafe</b>"} ${safe("<strong>safe</strong>")}</p>`;

    expect(rawHtml(rendered)).toBe("<p>&lt;b&gt;unsafe&lt;/b&gt; <strong>safe</strong></p>");
  });

  it("renders arrays and skips nullish/false values without layout text", () => {
    const rendered = html`<ul>${[
      html`<li>${"A&B"}</li>`,
      null,
      false,
      html`<li>${"C"}</li>`,
    ]}</ul>`;

    expect(rawHtml(rendered)).toBe("<ul><li>A&amp;B</li><li>C</li></ul>");
  });
});

describe("renderMarkdown", () => {
  it("renders the supported markdown subset after escaping raw input", () => {
    const rendered = rawHtml(renderMarkdown(`# Title

Hello **bold** *em* \`code\`
- [safe](https://example.test/a)
- <script>alert(1)</script>`));

    expect(rendered).toContain("<h3>Title</h3>");
    expect(rendered).toContain("<strong>bold</strong>");
    expect(rendered).toContain("<em>em</em>");
    expect(rendered).toContain("<code>code</code>");
    expect(rendered).toContain('<a href="https://example.test/a" target="_blank" rel="noopener noreferrer">safe</a>');
    expect(rendered).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does not link non-http URLs", () => {
    const rendered = rawHtml(renderMarkdown("[bad](javascript:alert(1))"));

    expect(rendered).not.toContain("<a ");
    expect(rendered).toContain("[bad](javascript:alert(1))");
  });
});
