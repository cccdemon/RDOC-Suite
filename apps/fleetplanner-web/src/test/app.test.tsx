import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { App } from "../App";
import { server } from "./setup";
import { opDetailFixture, opSummaryFixture, sessionCrew, sessionGuest } from "./fixtures";

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
    expect(screen.getAllByText("OFFEN").length).toBeGreaterThanOrEqual(1);
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
    const { findByTestId, findByText, queryByTestId } = renderAt("/ops/op_1");
    (await findByTestId("offer-ship-open")).click();
    (await findByText("Carrack")).closest("label")!.querySelector("input")!.click();
    (await findByTestId("offer-ship-submit")).click();
    // form closes again after success (entry card stays)
    await new Promise((r) => setTimeout(r, 50));
    expect(queryByTestId("offer-ship-form")).not.toBeInTheDocument();
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

describe("Op detail — offer squad / vehicle", () => {
  it("offers a squad with name + size", async () => {
    let payload: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.post(`${API}/operations/op_1/units`, async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, unitId: "unit_sq" });
      }),
    );
    const { findByTestId } = renderAt("/ops/op_1");
    (await findByTestId("offer-ship-open")).click();
    (await findByTestId("offer-mode-squad")).click();
    const name = (await findByTestId("squad-name")) as HTMLInputElement;
    // fire native input event so React's onChange picks it up
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(name, "Bravo Team");
    name.dispatchEvent(new Event("input", { bubbles: true }));
    (await findByTestId("offer-ship-submit")).click();
    expect(await findByTestId("offer-ship-open")).toBeInTheDocument();
    expect(payload).toMatchObject({ unitType: "squad", squadName: "Bravo Team", squadSize: 4 });
  });

  it("offers a vehicle with a required carrier", async () => {
    let payload: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/ships/search`, () =>
        HttpResponse.json({
          ships: [
            { id: "veh_1", slug: "cyclone", name: "Cyclone", manufacturer: "TMBL", size: "Vehicle", role: "Recon", minCrew: 1, maxCrew: 2 },
            { id: "ship_x", slug: "carrack", name: "Carrack", manufacturer: "ANVL", size: "Large", role: "Expedition", minCrew: 4, maxCrew: 6 },
          ],
        }),
      ),
      http.post(`${API}/operations/op_1/units`, async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, unitId: "unit_v" });
      }),
    );
    const { findByTestId, findByText, queryByText } = renderAt("/ops/op_1");
    (await findByTestId("offer-ship-open")).click();
    (await findByTestId("offer-mode-vehicle")).click();
    const search = (await findByTestId("ship-search")) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(search, "cy");
    search.dispatchEvent(new Event("input", { bubbles: true }));
    // vehicle filter: only the Cyclone shows up
    (await findByText("Cyclone")).closest("label")!.querySelector("input")!.click();
    expect(queryByText("Carrack")).not.toBeInTheDocument();
    const carrier = (await findByTestId("carrier-select")) as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(carrier, "unit_1");
    carrier.dispatchEvent(new Event("change", { bubbles: true }));
    (await findByTestId("offer-ship-submit")).click();
    expect(await findByTestId("offer-ship-open")).toBeInTheDocument();
    expect(payload).toMatchObject({ unitType: "vehicle", shipId: "veh_1", carrierUnitId: "unit_1" });
  });
});

describe("Op detail — operator panel", () => {
  const operatorView = {
    crewRequests: [{ userId: "user_flex", username: "Flexi", note: "Gerne Medic", createdAt: "2026-06-11T10:00:00.000Z" }],
    questions: [
      { id: "q1", asker: "Asker One", body: "Treffpunkt?", answer: null, answeredBy: null, createdAt: "2026-06-11T10:00:00.000Z" },
    ],
    hangarShares: [
      { userId: "user_h", username: "Hangar Guy", note: null, ships: [{ id: "s1", name: "Polaris", nickname: null }] },
    ],
    auditLogs: [],
  };
  const opAsOperator = {
    ...opDetailFixture,
    canManage: true,
    units: [
      ...opDetailFixture.units,
      {
        id: "unit_p", unitType: "ship", status: "pending", name: "Hammerhead", shipName: "Hammerhead",
        squadName: null, captain: { id: "u9", username: "Niner" }, captainNote: null, carrierUnitId: null, seats: [],
      },
    ],
  };

  function useOperatorHandlers(extra: Parameters<typeof server.use>[0][] = []) {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(opAsOperator)),
      http.get(`${API}/operations/op_1/operator`, () => HttpResponse.json(operatorView)),
      ...extra,
    );
  }

  it("renders pending units, flex signups, questions and hangar shares", async () => {
    useOperatorHandlers();
    const { findByTestId, findByText } = renderAt("/ops/op_1");
    (await findByTestId("operator-toggle")).click();
    expect(await findByTestId("operator-panel")).toBeInTheDocument();
    expect(await findByText("Hammerhead")).toBeInTheDocument();
    expect(await findByText("Flexi")).toBeInTheDocument();
    expect(await findByText("Treffpunkt?")).toBeInTheDocument();
    // hangar shares live in the collapsible tools drawer (design)
    (await findByText("Werkzeuge / Aktivität")).click();
    expect(await findByText("Hangar Guy")).toBeInTheDocument();
    expect(await findByText("Polaris")).toBeInTheDocument();
  });

  it("assigns a flexible signup via place-mode (Einteilen → seat click)", async () => {
    let payload: Record<string, unknown> | null = null;
    let seatId: string | null = null;
    useOperatorHandlers([
      http.put(`${API}/operations/op_1/seats/:seatId/assignment`, async ({ request, params }) => {
        seatId = String(params.seatId);
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    ]);
    const { findByTestId, findByText } = renderAt("/ops/op_1");
    (await findByTestId("operator-toggle")).click();
    (await findByTestId("op-place-user_flex")).click();
    // place-mode banner appears, open seats become green targets
    expect(await findByText("EINTEILEN-MODUS")).toBeInTheDocument();
    (await findByTestId("op-target-seat_2")).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(seatId).toBe("seat_2");
    expect(payload).toMatchObject({ userId: "user_flex" });
  });

  it("fills an open seat via the inline picker", async () => {
    let payload: Record<string, unknown> | null = null;
    useOperatorHandlers([
      http.put(`${API}/operations/op_1/seats/seat_2/assignment`, async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    ]);
    const { findByTestId, findByText } = renderAt("/ops/op_1");
    (await findByTestId("operator-toggle")).click();
    (await findByTestId("op-target-seat_2")).click(); // no place-mode → picker
    expect(await findByText("WER SOLL HIER REIN?")).toBeInTheDocument();
    (await findByTestId("op-pick-user_flex")).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(payload).toMatchObject({ userId: "user_flex" });
  });

  it("answers an open question", async () => {
    let payload: Record<string, unknown> | null = null;
    useOperatorHandlers([
      http.post(`${API}/operations/op_1/questions/q1/answer`, async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    ]);
    const { findByTestId } = renderAt("/ops/op_1");
    (await findByTestId("operator-toggle")).click();
    const input = (await findByTestId("answer-input-q1")) as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Everus Harbor, 19:00");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    (await findByTestId("answer-send-q1")).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(payload).toMatchObject({ answer: "Everus Harbor, 19:00" });
  });

  it("switches to Triage layout and assigns via drag & drop", async () => {
    let payload: Record<string, unknown> | null = null;
    let seatId: string | null = null;
    useOperatorHandlers([
      http.put(`${API}/operations/op_1/seats/:seatId/assignment`, async ({ request, params }) => {
        seatId = String(params.seatId);
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    ]);
    const { findByTestId } = renderAt("/ops/op_1");
    (await findByTestId("operator-toggle")).click();
    (await findByTestId("op-layout-b")).click();
    // drag the flex person onto the open seat
    const person = await findByTestId("op-place-user_flex");
    const row = person.closest("[draggable]")!;
    const dt = { setData: () => {}, getData: () => "user_flex", effectAllowed: "", dropEffect: "" };
    row.dispatchEvent(Object.assign(new Event("dragstart", { bubbles: true }), { dataTransfer: dt }));
    const seat = await findByTestId("op-target-seat_2");
    seat.dispatchEvent(Object.assign(new Event("dragover", { bubbles: true, cancelable: true }), { dataTransfer: dt }));
    seat.dispatchEvent(Object.assign(new Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: dt }));
    await new Promise((r) => setTimeout(r, 50));
    expect(seatId).toBe("seat_2");
    expect(payload).toMatchObject({ userId: "user_flex" });
  });

  it("appoints a participant as leader (fleet operator)", async () => {
    let payload: Record<string, unknown> | null = null;
    const opFO = {
      ...opAsOperator,
      viewerRole: "fleetoperator",
      leaders: [],
      units: [
        {
          id: "unit_1", unitType: "ship", status: "accepted", name: "Perseus", shipName: "Perseus",
          squadName: null, captain: null, captainNote: null, carrierUnitId: null,
          seats: [{ id: "seat_a", label: "Pilot", order: 0, active: true, claimedBy: { id: "user_part", username: "Partaker" } }],
        },
      ],
    };
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(opFO)),
      http.get(`${API}/operations/op_1/operator`, () => HttpResponse.json(operatorView)),
      http.post(`${API}/operations/op_1/leaders`, async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/ops/op_1");
    (await findByTestId("operator-toggle")).click();
    (await findByTestId("leader-add-toggle")).click();
    (await findByTestId("leader-cand-user_part")).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(payload).toMatchObject({ userId: "user_part" });
  });

  it("hides leader management for non-fleet-operators", async () => {
    useOperatorHandlers(); // opAsOperator has canManage:true but no viewerRole
    const { findByTestId, queryByTestId } = renderAt("/ops/op_1");
    (await findByTestId("operator-toggle")).click();
    await findByTestId("operator-panel");
    expect(queryByTestId("leader-add-toggle")).not.toBeInTheDocument();
  });

  it("accepts a pending unit", async () => {
    let hit = false;
    useOperatorHandlers([
      http.post(`${API}/operations/op_1/units/unit_p/accept`, () => {
        hit = true;
        return HttpResponse.json({ ok: true });
      }),
    ]);
    const { findByTestId } = renderAt("/ops/op_1");
    (await findByTestId("operator-toggle")).click();
    (await findByTestId("accept-unit_p")).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(hit).toBe(true);
  });
});

describe("Operations calendar", () => {
  it("renders the current month, an op in its day cell, and links to the op", async () => {
    const today = new Date();
    const scheduled = new Date(today.getFullYear(), today.getMonth(), 15, 20, 30, 0);
    const ev = {
      ...opSummaryFixture,
      id: "op_cal",
      title: "Quantanium-Mining HUR-L1",
      opType: "mining",
      scheduledAt: scheduled.toISOString(),
      filledSeats: 14,
      totalSeats: 16,
    };
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
      http.get(`${API}/operations`, () => HttpResponse.json({ operations: [ev] })),
    );
    const { findByTestId, getAllByText } = renderAt("/calendar");
    expect(await findByTestId("calendar-page")).toBeInTheDocument();
    // title appears in the month cell
    expect(getAllByText("Quantanium-Mining HUR-L1").length).toBeGreaterThanOrEqual(1);
    // select day 15 → detail card shows the open link to the op
    (await findByTestId("cal-day-15")).click();
    expect(await findByTestId("cal-open-op_cal")).toHaveAttribute("href", "/ops/op_cal");
  });

  it("filters by type", async () => {
    const today = new Date();
    const mk = (id: string, opType: string, day: number) => ({
      ...opSummaryFixture,
      id,
      opType,
      title: `${opType}-op`,
      scheduledAt: new Date(today.getFullYear(), today.getMonth(), day, 20, 0, 0).toISOString(),
    });
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
      http.get(`${API}/operations`, () => HttpResponse.json({ operations: [mk("a", "mining", 5), mk("b", "combat", 6)] })),
    );
    const { findByTestId, queryAllByText } = renderAt("/calendar");
    await findByTestId("calendar-page");
    (await findByTestId("cal-filter-combat")).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(queryAllByText("mining-op").length).toBe(0);
    expect(queryAllByText("combat-op").length).toBeGreaterThanOrEqual(1);
  });
});

describe("Login page", () => {
  it("links to the same-origin Discord OAuth start", async () => {
    renderAt("/login");
    const link = await screen.findByText("Mit Discord anmelden");
    expect(link).toHaveAttribute("href", "/fleetplanner/auth/discord/start");
  });
});
