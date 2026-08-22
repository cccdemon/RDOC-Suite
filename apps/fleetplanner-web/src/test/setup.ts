import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

// The SPA picks its locale from navigator.language when nothing is stored, and
// jsdom reports "en-US" — which silently flips every German assertion in this
// suite. Pin the language instead of asserting in two languages.
Object.defineProperty(window.navigator, "language", { value: "de-DE", configurable: true });

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
// vitest runs with globals:false, so Testing Library's automatic cleanup
// never registers — do it explicitly or the DOM accumulates across tests.
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
