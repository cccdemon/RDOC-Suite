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
    // guest footer offers the login link (rendered in both the desktop sidebar
    // and the mobile head, so there are two in the DOM)
    expect((await screen.findAllByTestId("login-link")).length).toBeGreaterThanOrEqual(1);
  });

  it("authenticated: shows username and the joined badge", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations`, () =>
        HttpResponse.json({ operations: [{ ...opSummaryFixture, signupState: "joined" }] }),
      ),
    );
    renderAt("/");
    // username now appears in the sidebar footer (and possibly the page)
    expect((await screen.findAllByText("Crew One")).length).toBeGreaterThanOrEqual(1);
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
    // "Anmelden" appears in both the splash button and the guest sidebar
    expect(screen.getAllByText("Anmelden").length).toBeGreaterThanOrEqual(1);
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

  // minimal needs payload — the fleet tab also mounts the NeedsEditor (fetches /needs)
  const emptyNeeds = { shipTypes: [], cqbTeamMax: 8, cqbTeamDefault: 4, fighterSquadSize: 2, shipNeeds: [], fighterSquads: 0, cqbTeams: { count: 0, size: 4 } };

  function useOperatorHandlers(extra: Parameters<typeof server.use>[0][] = []) {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(opAsOperator)),
      http.get(`${API}/operations/op_1/operator`, () => HttpResponse.json(operatorView)),
      http.get(`${API}/operations/op_1/needs`, () => HttpResponse.json(emptyNeeds)),
      ...extra,
    );
  }

  // The operator board lives in the Op-Management "Flotte & Warteliste" tab.
  async function openFleetTab(findByTestId: (id: string) => Promise<HTMLElement>) {
    (await findByTestId("manage-tab-fleet")).click();
  }

  it("renders pending units, flex signups, questions and hangar shares", async () => {
    useOperatorHandlers();
    const { findByTestId, findByText } = renderAt("/ops/op_1");
    await openFleetTab(findByTestId);
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
    await openFleetTab(findByTestId);
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
    await openFleetTab(findByTestId);
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
    await openFleetTab(findByTestId);
    const input = (await findByTestId("answer-input-q1")) as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Everus Harbor, 19:00");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    (await findByTestId("answer-send-q1")).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(payload).toMatchObject({ answer: "Everus Harbor, 19:00" });
  });

  it("assigns via drag & drop (Triage layout, default when embedded)", async () => {
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
    await openFleetTab(findByTestId);
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

  it("appoints a participant as leader (Commanders tab, fleet operator)", async () => {
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
      // commanders are appointed from the guild member list now (not seat-holders)
      http.get(`${API}/guilds/guild_1/settings`, () =>
        HttpResponse.json({
          guild: { id: "guild_1", name: "RDOC", orgName: "RDOC", timezone: "Europe/Berlin", discordInviteUrl: null, admiralRoleId: null, ownerUserId: "x", canRemove: false },
          members: [{ userId: "user_part", username: "Partaker", role: "crew", isOwner: false }],
        }),
      ),
      http.post(`${API}/operations/op_1/leaders`, async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/ops/op_1");
    (await findByTestId("manage-tab-commanders")).click();
    (await findByTestId("leader-cand-user_part")).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(payload).toMatchObject({ userId: "user_part" });
  });

  it("hides leader appointment for non-fleet-operators", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(opAsOperator)), // canManage:true, no viewerRole
    );
    const { findByTestId, queryByText } = renderAt("/ops/op_1");
    (await findByTestId("manage-tab-commanders")).click();
    await findByTestId("commanders-panel");
    expect(queryByText("MITGLIED ERNENNEN")).not.toBeInTheDocument();
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
    await openFleetTab(findByTestId);
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
    // month grid (cells) is a desktop-only view; switch to it first
    (await findByTestId("cal-view-monat")).click();
    // title appears in the month cell
    expect(getAllByText("Quantanium-Mining HUR-L1").length).toBeGreaterThanOrEqual(1);
    // select day 15 → detail card shows the open link to the op
    (await findByTestId("cal-day-15")).click();
    expect(await findByTestId("cal-open-op_cal")).toHaveAttribute("href", "/ops/op_cal");
  });

  it("agenda hides past events by default, toggle reveals them", async () => {
    const t = new Date();
    const [y, m, d] = [t.getFullYear(), t.getMonth(), t.getDate()];
    const pastEv = { ...opSummaryFixture, id: "past_op", title: "Past Op", scheduledAt: new Date(y, m, d, 0, 0, 0).toISOString() };
    const futureEv = { ...opSummaryFixture, id: "future_op", title: "Future Op", scheduledAt: new Date(y, m, d, 23, 59, 0).toISOString() };
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
      http.get(`${API}/operations`, () => HttpResponse.json({ operations: [pastEv, futureEv] })),
    );
    const { findByTestId, queryAllByText } = renderAt("/?view=agenda");
    await findByTestId("calendar-page");
    await new Promise((r) => setTimeout(r, 30));
    // default: only upcoming events in the agenda
    expect(queryAllByText("Future Op").length).toBeGreaterThanOrEqual(1);
    expect(queryAllByText("Past Op").length).toBe(0);
    // toggle past events on
    (await findByTestId("cal-toggle-past")).click();
    await new Promise((r) => setTimeout(r, 40));
    expect(queryAllByText("Past Op").length).toBeGreaterThanOrEqual(1);
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
    // month view shows all days incl. past, so the filter is date-independent
    (await findByTestId("cal-view-monat")).click();
    (await findByTestId("cal-filter-combat")).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(queryAllByText("mining-op").length).toBe(0);
    expect(queryAllByText("combat-op").length).toBeGreaterThanOrEqual(1);
  });
});

describe("Create operation", () => {
  it("submits and navigates to the new op (fleet operator)", async () => {
    let payload: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () =>
        HttpResponse.json({ ...sessionCrew, user: { ...sessionCrew.user, role: "fleetoperator" }, memberships: [{ guildId: "guild_1", guildName: "RDOC", role: "fleetoperator" }] }),
      ),
      http.get(`${API}/operations/op_new`, () => HttpResponse.json(opDetailFixture)),
      http.post(`${API}/operations`, async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, id: "op_new" });
      }),
    );
    const { findByTestId } = renderAt("/ops/new");
    // step 0 (Eckdaten): name + start
    const title = (await findByTestId("wiz-title")) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(title, "Stanton Patrol");
    title.dispatchEvent(new Event("input", { bubbles: true }));
    const when = (await findByTestId("wiz-when")) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(when, "2026-07-01T20:00");
    when.dispatchEvent(new Event("input", { bubbles: true }));
    // jump to the last step via the rail, then create
    (await findByTestId("wiz-step-5")).click();
    (await findByTestId("wiz-create")).click();
    // navigates to /ops/op_new → its title renders
    expect(await findByTestId("op-title")).toBeInTheDocument();
    expect(payload).toMatchObject({ guildId: "guild_1", title: "Stanton Patrol", opType: "combat" });
  });

  it("denies non-operators", async () => {
    server.use(http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)));
    const { findByTestId } = renderAt("/ops/new");
    expect(await findByTestId("create-denied")).toBeInTheDocument();
  });
});

describe("Profile / hangar", () => {
  const ship = { id: "ship_z1", slug: "perseus", name: "Perseus", manufacturer: "RSI", size: "Large", role: "Gunship", minCrew: 2, maxCrew: 6 };

  it("lists hangar ships and adds one from search", async () => {
    let added = false;
    let addedId: string | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/hangar`, () => HttpResponse.json({ ships: added ? [ship] : [] })),
      http.get(`${API}/ships/search`, () => HttpResponse.json({ ships: [ship] })),
      http.post(`${API}/hangar`, async ({ request }) => {
        addedId = ((await request.json()) as { shipId: string }).shipId;
        added = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId, findByText } = renderAt("/profile");
    expect(await findByTestId("profile-page")).toBeInTheDocument();
    const search = (await findByTestId("profile-search")) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(search, "per");
    search.dispatchEvent(new Event("input", { bubbles: true }));
    (await findByTestId("hangar-add-ship_z1")).click();
    // after reload the ship shows in the hangar list
    expect(await findByTestId("hangar-row-ship_z1")).toBeInTheDocument();
    expect(addedId).toBe("ship_z1");
    expect(await findByText("IM HANGAR")).toBeInTheDocument();
  });

  it("imports a fleet from pasted JSON (POST hangar/import)", async () => {
    let imported: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/hangar`, () => HttpResponse.json({ ships: [] })),
      http.post(`${API}/hangar/import`, async ({ request }) => {
        imported = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, total: 3, added: 2, already: 1, unmatched: ["Mystery Ship"] });
      }),
    );
    const { findByTestId } = renderAt("/profile");
    const ta = (await findByTestId("fleet-json")) as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(ta, '[{"name":"Polaris"}]');
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    (await findByTestId("fleet-import-submit")).click();
    const res = await findByTestId("import-result");
    expect(res).toHaveTextContent("2 neu");
    expect(res).toHaveTextContent("nicht zugeordnet");
    expect(imported).toMatchObject({ fleetJson: '[{"name":"Polaris"}]' });
  });

  it("anonymous sees a sign-in prompt", async () => {
    server.use(http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)));
    const { findByTestId } = renderAt("/profile");
    expect(await findByTestId("profile-anon")).toBeInTheDocument();
  });
});

describe("Templates marketplace", () => {
  it("lists templates and applies one to a new op (fleet operator)", async () => {
    let payload: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () =>
        HttpResponse.json({ ...sessionCrew, user: { ...sessionCrew.user, role: "fleetoperator" }, memberships: [{ guildId: "guild_1", guildName: "RDOC", role: "fleetoperator" }] }),
      ),
      http.get(`${API}/templates`, () =>
        HttpResponse.json({ templates: [{ id: "tpl_1", name: "Xeno Defense", summary: "std", opType: "combat", visibility: "public", usageCount: 5, ownerGuildName: "RDOC" }] }),
      ),
      http.get(`${API}/operations/op_t`, () => HttpResponse.json(opDetailFixture)),
      http.post(`${API}/templates/tpl_1/apply`, async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, id: "op_t" });
      }),
    );
    const { findByTestId } = renderAt("/templates");
    expect(await findByTestId("template-tpl_1")).toBeInTheDocument();
    (await findByTestId("template-apply-tpl_1")).click();
    const when = (await findByTestId("template-when-tpl_1")) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(when, "2026-07-02T20:00");
    when.dispatchEvent(new Event("input", { bubbles: true }));
    (await findByTestId("template-confirm-tpl_1")).click();
    expect(await findByTestId("op-title")).toBeInTheDocument();
    expect(payload).toMatchObject({ guildId: "guild_1" });
  });
});

describe("Roadmap", () => {
  it("renders grouped roadmap items", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
      http.get(`${API}/roadmap`, () =>
        HttpResponse.json({ items: [
          { title: "Org-Flotte", status: "planned", desc: "Schiffe der Mitglieder." },
          { title: "Alt-Idee", status: "rejected", desc: "Verworfen.", reason: "Zu teuer." },
        ] }),
      ),
    );
    const { findByTestId, findByText } = renderAt("/roadmap");
    expect(await findByTestId("roadmap-page")).toBeInTheDocument();
    expect(await findByText("Org-Flotte")).toBeInTheDocument();
    expect(await findByText("Zu teuer.")).toBeInTheDocument();
  });
});

describe("Ships database", () => {
  it("lists ships from the search API", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
      http.get(`${API}/ships/search`, () =>
        HttpResponse.json({ ships: [{ id: "s1", slug: "perseus", name: "Perseus", manufacturer: "RSI", size: "Large", role: "Gunship", minCrew: 2, maxCrew: 6 }] }),
      ),
    );
    const { findByTestId, findByText } = renderAt("/ships");
    expect(await findByTestId("ships-page")).toBeInTheDocument();
    expect(await findByText("Perseus")).toBeInTheDocument();
  });
});

describe("Feedback", () => {
  it("submits subject + message", async () => {
    let payload: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.post(`${API}/feedback`, async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/feedback");
    const subj = (await findByTestId("feedback-subject")) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(subj, "Bug");
    subj.dispatchEvent(new Event("input", { bubbles: true }));
    const msg = (await findByTestId("feedback-message")) as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(msg, "Seat picker glitch");
    msg.dispatchEvent(new Event("input", { bubbles: true }));
    (await findByTestId("feedback-submit")).click();
    expect(await findByTestId("feedback-notice")).toHaveTextContent("gesendet");
    expect(payload).toMatchObject({ subject: "Bug", message: "Seat picker glitch" });
  });

  it("anonymous sees a sign-in prompt", async () => {
    server.use(http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)));
    const { findByTestId } = renderAt("/feedback");
    expect(await findByTestId("feedback-anon")).toBeInTheDocument();
  });
});

describe("Op editor (lifecycle)", () => {
  const opEditable = { ...opDetailFixture, canManage: true };

  it("operator edits meta and saves (PATCH)", async () => {
    let patched: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(opEditable)),
      http.patch(`${API}/operations/op_1`, async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/ops/op_1/edit");
    const title = (await findByTestId("edit-title")) as HTMLInputElement;
    expect(title.value).toBe("Xenothreat Logistics");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(title, "Renamed Op");
    title.dispatchEvent(new Event("input", { bubbles: true }));
    (await findByTestId("edit-save")).click();
    expect(await findByTestId("manage-notice")).toHaveTextContent("Gespeichert");
    expect(patched).toMatchObject({ title: "Renamed Op", opType: "combat" });
  });

  it("operator changes status (POST status, Admin tab)", async () => {
    let statusBody: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json({ ...opEditable, status: "draft" })),
      http.post(`${API}/operations/op_1/status`, async ({ request }) => {
        statusBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, status: "open" });
      }),
    );
    const { findByTestId } = renderAt("/ops/op_1/edit");
    (await findByTestId("manage-tab-admin")).click();
    const sel = (await findByTestId("manage-status")) as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(sel, "open");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    (await findByTestId("manage-status-apply")).click();
    await findByTestId("manage-notice");
    expect(statusBody).toMatchObject({ status: "open" });
  });

  it("operator deletes with confirm (DELETE)", async () => {
    let deleted = false;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(opEditable)),
      http.get(`${API}/operations`, () => HttpResponse.json({ operations: [] })),
      http.delete(`${API}/operations/op_1`, () => {
        deleted = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/ops/op_1/edit");
    (await findByTestId("edit-delete")).click();
    (await findByTestId("edit-delete-confirm")).click();
    // delete navigates to "/" → the Operationen screen header
    await screen.findByTestId("cal-month");
    expect(deleted).toBe(true);
  });

  it("non-operator sees a forbidden state", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json({ ...opDetailFixture, canManage: false })),
    );
    const { findByTestId, queryByTestId } = renderAt("/ops/op_1/edit");
    // a non-leader lands on the op-detail player view with no operator console
    expect(await findByTestId("op-title")).toBeInTheDocument();
    expect(queryByTestId("operator-console")).not.toBeInTheDocument();
  });
});

describe("Op editor admin (template + recurrence)", () => {
  const opEditable = { ...opDetailFixture, canManage: true };

  it("publishes the op as a template (POST publish-template)", async () => {
    let published: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(opEditable)),
      http.post(`${API}/operations/op_1/publish-template`, async ({ request }) => {
        published = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, id: "tpl_1" });
      }),
    );
    const { findByTestId } = renderAt("/ops/op_1/edit");
    (await findByTestId("manage-tab-admin")).click();
    const name = (await findByTestId("tpl-name")) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(name, "Xeno Blueprint");
    name.dispatchEvent(new Event("input", { bubbles: true }));
    (await findByTestId("tpl-publish")).click();
    expect(await findByTestId("manage-notice")).toHaveTextContent("veröffentlicht");
    expect(published).toMatchObject({ name: "Xeno Blueprint", visibility: "guild" });
  });

  it("creates a recurring series (POST recurrence)", async () => {
    let recurBody: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(opEditable)),
      http.post(`${API}/operations/op_1/recurrence`, async ({ request }) => {
        recurBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/ops/op_1/edit");
    (await findByTestId("manage-tab-admin")).click();
    (await findByTestId("recur-create")).click();
    expect(await findByTestId("manage-notice")).toHaveTextContent("Serie erstellt");
    expect(recurBody).toMatchObject({ freq: "weekly" });
  });

  it("stops a recurring series (POST recurrence/stop)", async () => {
    let hit = false;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(opEditable)),
      http.post(`${API}/operations/op_1/recurrence/stop`, () => {
        hit = true;
        return HttpResponse.json({ ok: true, stopped: true });
      }),
    );
    const { findByTestId } = renderAt("/ops/op_1/edit");
    (await findByTestId("manage-tab-admin")).click();
    (await findByTestId("recurrence-stop")).click();
    expect(await findByTestId("manage-notice")).toHaveTextContent("gestoppt");
    expect(hit).toBe(true);
  });
});

describe("Op needs editor (Bedarfe)", () => {
  const opEditable = { ...opDetailFixture, canManage: true };
  const needs = {
    shipTypes: [
      { slug: "any", label: "Any ship" },
      { slug: "capital", label: "Capital" },
    ],
    cqbTeamMax: 8,
    cqbTeamDefault: 4,
    fighterSquadSize: 2,
    shipNeeds: [{ id: "req_1", shipType: "capital", label: "Flagship", note: null }],
    fighterSquads: 0,
    cqbTeams: { count: 0, size: 4 },
  };

  it("adds a ship need (POST needs/ships) with the picked types", async () => {
    let added: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(opEditable)),
      http.get(`${API}/operations/op_1/operator`, () => HttpResponse.json({ crewRequests: [], questions: [], hangarShares: [], auditLogs: [] })),
      http.get(`${API}/operations/op_1/needs`, () => HttpResponse.json(needs)),
      http.post(`${API}/operations/op_1/needs/ships`, async ({ request }) => {
        added = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, added: 1 });
      }),
    );
    const { findByTestId } = renderAt("/ops/op_1/edit");
    (await findByTestId("manage-tab-fleet")).click();
    // the need name is now an inline-editable input (value, not text content)
    const needRow = await findByTestId("need-row-req_1");
    expect((needRow.querySelector("input") as HTMLInputElement).value).toBe("Flagship");
    (await findByTestId("shiptype-capital")).click();
    (await findByTestId("need-add")).click();
    await findByTestId("needs-editor");
    expect(added).toMatchObject({ shipTypes: ["capital"] });
  });

  it("sets the fighter-squad count (PUT needs/fighters)", async () => {
    let put: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(opEditable)),
      http.get(`${API}/operations/op_1/operator`, () => HttpResponse.json({ crewRequests: [], questions: [], hangarShares: [], auditLogs: [] })),
      http.get(`${API}/operations/op_1/needs`, () => HttpResponse.json(needs)),
      http.put(`${API}/operations/op_1/needs/fighters`, async ({ request }) => {
        put = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/ops/op_1/edit");
    (await findByTestId("manage-tab-fleet")).click();
    const count = (await findByTestId("fighters-count")) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(count, "3");
    count.dispatchEvent(new Event("input", { bubbles: true }));
    (await findByTestId("fighters-save")).click();
    await findByTestId("needs-editor");
    expect(put).toMatchObject({ count: 3 });
  });
});

describe("Guild partnerships", () => {
  const sessionFO = {
    user: { id: "user_admiral", username: "Admiral", role: "fleetoperator", locale: "de" },
    memberships: [{ guildId: "123456789012345678", guildName: "RDOC", role: "fleetoperator" }],
    csrfToken: "csrf-test-token",
  };
  const partsBody = {
    partnerships: [
      { id: "pp_1", label: "Allianz X", status: "active", partnerGuildId: "987654321098765432", partnerGuildName: "Ally Org", isInitiator: true, activatedAt: "2026-06-01T10:00:00.000Z", createdAt: "2026-05-30T10:00:00.000Z", autoShare: false },
    ],
    incoming: [
      { id: "ev_1", opId: "op_x", opTitle: "Joint Patrol", scheduledAt: "2026-06-20T18:00:00.000Z", meetingSystem: "Stanton", meetingLocation: "Port", hostGuildName: "Ally Org", hostOrgName: null },
    ],
  };

  it("operator mints a partner invite token", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionFO)),
      http.get(`${API}/guilds/123456789012345678/partnerships`, () => HttpResponse.json(partsBody)),
      http.post(`${API}/guilds/123456789012345678/partnerships/invite`, () =>
        HttpResponse.json({ ok: true, token: "secret-token-xyz", label: "Allianz Y" }),
      ),
    );
    const { findByTestId } = renderAt("/guilds/partnerships");
    const lbl = (await findByTestId("invite-label")) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(lbl, "Allianz Y");
    lbl.dispatchEvent(new Event("input", { bubbles: true }));
    (await findByTestId("invite-mint")).click();
    expect(await findByTestId("minted-token")).toHaveTextContent("secret-token-xyz");
  });

  it("operator approves an incoming shared event", async () => {
    let approved = false;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionFO)),
      http.get(`${API}/guilds/123456789012345678/partnerships`, () => HttpResponse.json(partsBody)),
      http.post(`${API}/guilds/123456789012345678/partnerships/events/ev_1/approve`, () => {
        approved = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/guilds/partnerships");
    (await findByTestId("incoming-approve-ev_1")).click();
    await findByTestId("partner-pp_1");
    expect(approved).toBe(true);
  });

  it("crew member without operator role sees a no-rights state", async () => {
    server.use(http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)));
    const { findByTestId } = renderAt("/guilds/partnerships");
    expect(await findByTestId("partnerships-none")).toBeInTheDocument();
  });
});

describe("Admin guild management", () => {
  const sessionSuper = {
    user: { id: "user_root", username: "Root", role: "superadmin", locale: "de" },
    memberships: [],
    csrfToken: "csrf-test-token",
  };
  const adminGuilds = {
    guilds: [
      { id: "111111111111111111", name: "Active Org", active: true, bannedAt: null, ownerUserId: "u1", memberCount: 12 },
      { id: "222222222222222222", name: "Bad Org", active: false, bannedAt: "2026-06-01T10:00:00.000Z", ownerUserId: "u2", memberCount: 3 },
    ],
  };

  const adminUsers = {
    users: [
      { id: "user_root", username: "Root", role: "superadmin", active: true, discordId: "111", discordName: "root", guilds: [{ name: "RDOC", role: "fleetoperator" }], lastSeen: "2026-06-12T10:00:00.000Z" },
      { id: "user_x", username: "Member X", role: "crew", active: true, discordId: null, discordName: null, guilds: [], lastSeen: "2026-06-11T10:00:00.000Z" },
    ],
  };
  const adminSettings = {
    maintenanceOn: false,
    maintenanceForcedByEnv: false,
    feedbackChannelId: "",
    shipCatalog: { count: 247, lastRun: "2026-06-10T10:00:00.000Z", intervalDays: 7, running: false },
    locationCatalog: { count: 1842, lastRun: "2026-06-10T10:00:00.000Z", intervalDays: 7, running: false },
    operationCount: 19,
  };
  const adminBaseHandlers = () => [
    http.get(`${API}/admin/guilds`, () => HttpResponse.json(adminGuilds)),
    http.get(`${API}/admin/users`, () => HttpResponse.json(adminUsers)),
    http.get(`${API}/admin/settings`, () => HttpResponse.json(adminSettings)),
  ];

  it("superadmin lists guilds and bans one", async () => {
    let banned = false;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionSuper)),
      ...adminBaseHandlers(),
      http.post(`${API}/admin/guilds/111111111111111111/ban`, () => {
        banned = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/admin");
    expect(await findByTestId("admin-guild-111111111111111111")).toHaveTextContent("Active Org");
    expect(await findByTestId("admin-unban-222222222222222222")).toBeInTheDocument();
    (await findByTestId("admin-ban-111111111111111111")).click();
    await findByTestId("admin-page");
    expect(banned).toBe(true);
  });

  it("superadmin changes a user's role (PUT role)", async () => {
    let roleBody: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionSuper)),
      ...adminBaseHandlers(),
      http.put(`${API}/admin/users/user_x/role`, async ({ request }) => {
        roleBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/admin");
    const sel = (await findByTestId("admin-user-role-user_x")) as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(sel, "fleetoperator");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await findByTestId("admin-page");
    expect(roleBody).toMatchObject({ role: "fleetoperator" });
  });

  it("superadmin toggles maintenance mode (POST maintenance)", async () => {
    let maint: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionSuper)),
      ...adminBaseHandlers(),
      http.post(`${API}/admin/maintenance`, async ({ request }) => {
        maint = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/admin");
    (await findByTestId("maint-toggle")).click();
    await findByTestId("admin-settings");
    expect(maint).toMatchObject({ enabled: true });
  });

  it("non-superadmin sees a forbidden state", async () => {
    server.use(http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)));
    const { findByTestId } = renderAt("/admin");
    expect(await findByTestId("admin-forbidden")).toBeInTheDocument();
  });
});

describe("Login page", () => {
  it("links to the same-origin Discord OAuth start", async () => {
    renderAt("/login");
    const link = await screen.findByText("Mit Discord anmelden");
    expect(link).toHaveAttribute("href", "/fleetplanner/auth/discord/start");
  });
});

describe("Guild settings", () => {
  const sessionFO = {
    user: { id: "user_admiral", username: "Admiral", role: "fleetoperator", locale: "de" },
    memberships: [{ guildId: "123456789012345678", guildName: "RDOC", role: "fleetoperator" }],
    csrfToken: "csrf-test-token",
  };
  const settingsBody = {
    guild: {
      id: "123456789012345678",
      name: "RDOC",
      orgName: "Raumdock Fleet",
      timezone: "Europe/Berlin",
      discordInviteUrl: null,
      admiralRoleId: null,
      ownerUserId: "user_admiral",
      canRemove: true,
    },
    members: [
      { userId: "user_admiral", username: "Admiral", role: "fleetoperator", isOwner: true },
      { userId: "user_crew", username: "Crew One", role: "crew", isOwner: false },
    ],
  };

  it("operator: edits org name and saves (PATCH)", async () => {
    let patched: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionFO)),
      http.get(`${API}/guilds/123456789012345678/settings`, () => HttpResponse.json(settingsBody)),
      http.patch(`${API}/guilds/123456789012345678/settings`, async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/guilds/settings");
    const org = (await findByTestId("guild-orgname")) as HTMLInputElement;
    expect(org.value).toBe("Raumdock Fleet");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(org, "New Org");
    org.dispatchEvent(new Event("input", { bubbles: true }));
    (await findByTestId("guild-save")).click();
    expect(await findByTestId("guild-notice")).toHaveTextContent("Gespeichert");
    expect(patched).toMatchObject({ orgName: "New Org", timezone: "Europe/Berlin" });
  });

  it("operator: promotes a crew member (PUT role)", async () => {
    let roleBody: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionFO)),
      http.get(`${API}/guilds/123456789012345678/settings`, () => HttpResponse.json(settingsBody)),
      http.put(`${API}/guilds/123456789012345678/members/user_crew/role`, async ({ request }) => {
        roleBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { findByTestId } = renderAt("/guilds/settings");
    (await findByTestId("member-toggle-user_crew")).click();
    await screen.findByTestId("member-row-user_admiral");
    expect(roleBody).toMatchObject({ role: "fleetoperator" });
  });

  it("crew member without operator role sees a no-rights state", async () => {
    server.use(http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)));
    const { findByTestId } = renderAt("/guilds/settings");
    expect(await findByTestId("guild-none")).toBeInTheDocument();
  });
});
