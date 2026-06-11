import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { App } from "../App";
import { server } from "./setup";
import { opSummaryFixture, sessionCrew } from "./fixtures";

const API = "/fleetplanner/api/v1";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("Overview", () => {
  it("guest: renders public op cards and the login CTA", async () => {
    renderAt("/");
    expect(await screen.findByText("Xenothreat Logistics")).toBeInTheDocument();
    expect(screen.getByTestId("login-cta")).toBeInTheDocument();
    expect(await screen.findByText("GAST")).toBeInTheDocument();
  });

  it("authenticated: shows username and the joined badge", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations`, () =>
        HttpResponse.json({ operations: [{ ...opSummaryFixture, signupState: "joined" }] }),
      ),
    );
    renderAt("/");
    expect(await screen.findByText("Crew One")).toBeInTheDocument();
    expect(await screen.findByText("DABEI")).toBeInTheDocument();
  });

  it("API 503 → maintenance state", async () => {
    server.use(
      http.get(`${API}/operations`, () =>
        HttpResponse.json(
          { error: { code: "internal", message: "down", requestId: "req-x" } },
          { status: 503 },
        ),
      ),
    );
    renderAt("/");
    expect(await screen.findByTestId("error-503")).toBeInTheDocument();
  });
});

describe("Op detail", () => {
  it("renders title, date, units, seats and resource links read-only", async () => {
    renderAt("/ops/op_1");
    expect(await screen.findByTestId("op-title")).toHaveTextContent("Xenothreat Logistics");
    expect(screen.getByTestId("unit-card")).toBeInTheDocument();
    expect(screen.getByText("Pilot")).toBeInTheDocument();
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("OFFEN")).toBeInTheDocument();
    expect(screen.getByText(/Briefing/)).toBeInTheDocument();
    // read-only: no claim controls in the skeleton
    expect(screen.queryByText(/Platz nehmen/)).not.toBeInTheDocument();
  });

  it("404 from the API → not-found state, no internals leaked", async () => {
    renderAt("/ops/op_unknown");
    expect(await screen.findByTestId("error-404")).toBeInTheDocument();
    expect(screen.queryByText(/req-test/)).not.toBeInTheDocument();
  });

  it("401 for a private op → login state", async () => {
    server.use(
      http.get(`${API}/operations/op_1`, () =>
        HttpResponse.json(
          { error: { code: "unauthenticated", message: "Sign in.", requestId: "req-y" } },
          { status: 401 },
        ),
      ),
    );
    renderAt("/ops/op_1");
    expect(await screen.findByTestId("error-401")).toBeInTheDocument();
    expect(screen.getByText("Anmelden")).toBeInTheDocument();
  });
});

describe("Login page", () => {
  it("links to the same-origin Discord OAuth start", async () => {
    renderAt("/login");
    const link = await screen.findByText("Mit Discord anmelden");
    expect(link).toHaveAttribute("href", "/fleetplanner/auth/discord/start");
  });
});
