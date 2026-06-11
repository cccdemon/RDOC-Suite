import { describe, it, expect } from "vitest";
import { normalizeUrl, deriveKind, youtubeId } from "../../services/resourceLinks.js";

describe("normalizeUrl", () => {
  it("accepts http/https and returns the normalised href", () => {
    expect(normalizeUrl("https://youtu.be/abc")).toBe("https://youtu.be/abc");
    expect(normalizeUrl("  http://example.com/x  ")).toBe("http://example.com/x");
  });
  it("rejects non-http(s), relative and empty inputs", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("data:text/html,x")).toBeNull();
    expect(normalizeUrl("/relative/path")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});

describe("deriveKind", () => {
  it("classifies known hosts", () => {
    expect(deriveKind("https://www.youtube.com/watch?v=x")).toBe("youtube");
    expect(deriveKind("https://youtu.be/x")).toBe("youtube");
    expect(deriveKind("https://robertsspaceindustries.com/community-hub/post/1")).toBe("rsi_hub");
    expect(deriveKind("https://docs.google.com/document/d/1")).toBe("gdoc");
    expect(deriveKind("https://cdn.example.com/diagram.PNG")).toBe("image");
    expect(deriveKind("https://example.com/guide")).toBe("link");
  });
});

describe("youtubeId", () => {
  it("extracts the video id from common forms", () => {
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/shorts/abc123")).toBe("abc123");
    expect(youtubeId("https://example.com/x")).toBeNull();
  });
});
