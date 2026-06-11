import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
// vitest runs with globals:false, so Testing Library's automatic cleanup
// never registers — do it explicitly or the DOM accumulates across tests.
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
