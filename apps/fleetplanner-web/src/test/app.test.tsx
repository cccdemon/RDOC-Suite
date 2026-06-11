import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { App } from "../App";
import { server } from "./setup";
import { opDetailFixture, opSummaryFixture, sessionCrew } from "./fixtures";

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

describe("Op detail — claim flow (authenticated)", () => {
  it("claims a free seat and re-renders with the user seated", async () => {
    let claimed = false;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.post(`${API}/operations/op_1/seats/seat_2/claim`, ({ request }) => {
        if (request.headers.get("x-csrf-token") !== sessionCrew.csrfToken) {
          return HttpResponse.json(
            { error: { code: "forbidden", message: "Invalid CSRF token.", requestId: "req-c" } },
            { status: 403 },
          );
        }
        claimed = true;
        return HttpResponse.json({ ok: true, seatId: "seat_2" });
      }),
      http.get(`${API}/operations/op_1`, () => {
        if (!claimed) return HttpResponse.json(opDetailFixture);
        const seated = structuredClone(opDetailFixture);
        seated.units[0].seats[1].claimedBy = { id: "user_crew", username: "Crew One" };
        return HttpResponse.json(seated);
      }),
    );
    const { findByTestId } = renderAt("/ops/op_1");
    const btn = await findByTestId("claim-seat_2");
    btn.click();
    // After reload the seat belongs to the user → the release button appears.
    expect(await findByTestId("unclaim-seat_2")).toBeInTheDocument();
    expect(claimed).toBe(true);
  });

  it("409 conflict shows a notice and keeps the page usable", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.post(`${API}/operations/op_1/seats/seat_2/claim`, () =>
        HttpResponse.json(
          { error: { code: "conflict", message: "Seat already taken", requestId: "req-x" } },
          { status: 409 },
        ),
      ),
    );
    const { findByTestId } = renderAt("/ops/op_1");
    const btn = await findByTestId("claim-seat_2");
    btn.click();
    const notice = await findByTestId("op-notice");
    expect(notice).toHaveTextContent("Seat already taken");
    expect(await findByTestId("op-title")).toBeInTheDocument();
  });
});

describe("Op detail — Mitmachen card (CQB + hangar share)", () => {
  it("signs up flexibly and toggles to the withdraw state", async () => {
    let signedUp = false;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.post(`${API}/operations/op_1/cqb/signup`, () => {
        signedUp = true;
        return HttpResponse.json({ ok: true });
      }),
      http.get(`${API}/operations/op_1`, () =>
        HttpResponse.json({ ...opDetailFixture, viewerCqbSignedUp: signedUp }),
      ),
    );
    const { findByTestId } = renderAt("/ops/op_1");
    (await findByTestId("cqb-signup")).click();
    expect(await findByTestId("cqb-withdraw")).toBeInTheDocument();
    expect(signedUp).toBe(true);
  });

  it("toggles the hangar share via PUT", async () => {
    let allow: boolean | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.put(`${API}/operations/op_1/hangar-share`, async ({ request }) => {
        allow = ((await request.json()) as { allow: boolean }).allow;
        return HttpResponse.json({ ok: true });
      }),
      http.get(`${API}/operations/op_1`, () =>
        HttpResponse.json({ ...opDetailFixture, viewerHangarShared: allow === true }),
      ),
    );
    const { findByTestId } = renderAt("/ops/op_1");
    const toggle = (await findByTestId("hangar-toggle")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    toggle.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(allow).toBe(true);
    expect(((await findByTestId("hangar-toggle")) as HTMLInputElement).checked).toBe(true);
  });

  it("guest sees no Mitmachen card", async () => {
    const { findByTestId, queryByTestId } = renderAt("/ops/op_1");
    await findByTestId("op-title");
    expect(queryByTestId("join-card")).not.toBeInTheDocument();
  });
});

describe("Op detail — offer own ship", () => {
  const hangarShips = [
    { id: "ship_h1", slug: "carrack", name: "Carrack", manufacturer: "ANVL", size: "Large", role: "Expedition", minCrew: 4, maxCrew: 6 },
  ];

  it("offers a hangar ship via POST /units", async () => {
    let payload: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/hangar`, () => HttpResponse.json({ ships: hangarShips })),
      http.post(`${API}/operations/op_1/units`, async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, unitId: "unit_new" });
      }),
    );
    const { findByTestId, findByText } = renderAt("/ops/op_1");
    (await findByTestId("offer-ship-open")).click();
    (await findByText("Carrack")).closest("label")!.querySelector("input")!.click();
    (await findByTestId("offer-ship-submit")).click();
    // form closes again after success
    expect(await findByTestId("offer-ship-open")).toBeInTheDocument();
    expect(payload).toMatchObject({ unitType: "ship", ownedShipId: "ship_h1" });
  });

  it("409 from /units surfaces as the notice and keeps the form usable", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/hangar`, () => HttpResponse.json({ ships: hangarShips })),
      http.post(`${API}/operations/op_1/units`, () =>
        HttpResponse.json(
          { error: { code: "conflict", message: "Operation is not open for registration.", requestId: "r" } },
          { status: 409 },
        ),
      ),
    );
    const { findByTestId, findByText } = renderAt("/ops/op_1");
    (await findByTestId("offer-ship-open")).click();
    (await findByText("Carrack")).closest("label")!.querySelector("input")!.click();
    (await findByTestId("offer-ship-submit")).click();
    expect(await findByTestId("op-notice")).toHaveTextContent("not open");
    expect(await findByTestId("offer-ship-form")).toBeInTheDocument();
  });
});

describe("Login page", () => {
  it("links to the same-origin Discord OAuth start", async () => {
    renderAt("/login");
    const link = await screen.findByText("Mit Discord anmelden");
    expect(link).toHaveAttribute("href", "/fleetplanner/auth/discord/start");
  });
});
