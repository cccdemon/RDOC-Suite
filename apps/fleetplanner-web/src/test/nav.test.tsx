import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { App } from "../App";
import { server } from "./setup";
import { opDetailFixture, sessionCrew, sessionGuest } from "./fixtures";
import { NAV_GROUPS, PRIMARY_ACTION, bestMatch, isVisible, navHref, visibleItems } from "../nav";
import type { SessionResponse } from "../api/types";

// Information architecture (2026-08-21). These tests pin the STRUCTURE — active
// item, gates, server context, mobile parity, URL-addressable tabs — not looks.
const API = "/fleetplanner/api/v1";

const sessionOperator: SessionResponse = {
  ...sessionCrew,
  memberships: [
    { guildId: "guild_1", guildName: "RDOC", role: "fleetoperator" },
    { guildId: "guild_2", guildName: "Second Fleet", role: "fleetoperator" },
  ],
};

// MemoryRouter keeps its own history, so "browser back" has to be triggered from
// inside the router — this probe also exposes the current URL to assertions.
function Probe() {
  const loc = useLocation();
  const nav = useNavigate();
  return (
    <>
      <span data-testid="probe-url">{loc.pathname + loc.search}</span>
      <button type="button" data-testid="probe-back" onClick={() => nav(-1)} />
    </>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Probe />
    </MemoryRouter>,
  );
}

function useSession(s: SessionResponse) {
  server.use(http.get(`${API}/session`, () => HttpResponse.json(s)));
}

beforeEach(() => {
  window.localStorage.clear();
});

// ── 1. Active menu item ──────────────────────────────────────────────────────
describe("IA — active menu item", () => {
  it("every /ops/* route belongs to the Operationen entry", () => {
    expect(bestMatch("/operationen")).toBe("/operationen");
    expect(bestMatch("/ops/op_1")).toBe("/operationen");
    expect(bestMatch("/ops/new")).toBe("/operationen");
    expect(bestMatch("/calendar")).toBe("/operationen");
  });

  it("longest match wins, so server sub-screens do not light up /guilds", () => {
    expect(bestMatch("/guilds")).toBe("/guilds");
    expect(bestMatch("/guilds/settings")).toBe("/guilds/settings");
    expect(bestMatch("/guilds/fleet")).toBe("/guilds/fleet");
    expect(bestMatch("/konto/feedback")).toBe("/konto/feedback");
  });

  it("marks Operationen active while an operation detail page is open", async () => {
    useSession(sessionCrew);
    renderAt("/ops/op_1");
    const item = await screen.findByTestId("nav-/operationen");
    expect(item.className).toContain("is-active");
    expect(item).toHaveAttribute("aria-current", "page");
  });
});

// ── 2. "Neue Operation" is an action ─────────────────────────────────────────
describe("IA — Neue Operation is an action", () => {
  it("is not a member of any nav group", () => {
    const allItems = NAV_GROUPS.flatMap((g) => g.items).map((i) => i.to);
    expect(allItems).not.toContain("/ops/new");
    expect(PRIMARY_ACTION.to).toBe("/ops/new");
  });

  it("renders above the groups for an operator, and not at all otherwise", async () => {
    useSession(sessionOperator);
    const { unmount } = renderAt("/operationen");
    const action = await screen.findByTestId("nav-/ops/new");
    expect(action.className).toContain("nav-item-action");
    expect(action.closest(".nav-group")).toBeNull();
    unmount();

    // Only a fleet operator can create an operation. Offering the action to a
    // crew member means the wizard is the first thing that says no.
    useSession(sessionCrew);
    const second = renderAt("/operationen");
    await screen.findByTestId("sidebar-nav");
    expect(screen.queryByTestId("nav-/ops/new")).toBeNull();
    second.unmount();

    useSession(sessionGuest);
    renderAt("/operationen");
    await screen.findByTestId("sidebar-nav");
    expect(screen.queryByTestId("nav-/ops/new")).toBeNull();
  });
});

// ── 3. Role-dependent visibility ─────────────────────────────────────────────
describe("IA — role-dependent visibility", () => {
  it("hides login-gated entries from guests", () => {
    const tos = visibleItems(null, { anyGuild: false, managesGuild: false }).map((i) => i.to);
    expect(tos).toContain("/operationen");
    // Templates can only be applied by an operator, so they are not a place a
    // guest or a crew member can usefully go.
    expect(tos).not.toContain("/templates");
    expect(tos).not.toContain("/guilds");
    expect(tos).not.toContain("/konto");
    expect(tos).not.toContain("/konto/feedback");
  });

  it("shows server management only to a fleet operator of some guild", () => {
    const crew = visibleItems("crew", { anyGuild: true, managesGuild: false }).map((i) => i.to);
    expect(crew).toContain("/guilds");
    expect(crew).not.toContain("/guilds/settings");
    expect(crew).not.toContain("/guilds/partnerships");
    expect(crew).not.toContain("/guilds/diagnostics");

    const op = visibleItems("crew", { anyGuild: true, managesGuild: true }).map((i) => i.to);
    expect(op).toContain("/guilds/settings");
    expect(op).toContain("/guilds/partnerships");
    expect(op).toContain("/guilds/diagnostics");
    expect(op).toContain("/guilds/fleet");
  });

  it("keeps the admin console for superadmins only", () => {
    const admin = { to: "/admin", labelKey: "nav.admin", icon: "shield", gate: "superadmin" } as const;
    expect(isVisible(admin, "superadmin")).toBe(true);
    expect(isVisible(admin, "crew")).toBe(false);
    expect(isVisible(admin, null)).toBe(false);
  });

  it("renders the server group in the rail for an operator, not for a lone crew member", async () => {
    useSession(sessionOperator);
    const { unmount } = renderAt("/operationen");
    expect(await screen.findByTestId("nav-/guilds/settings")).toBeInTheDocument();
    unmount();

    useSession(sessionCrew); // crew in guild_1, operator nowhere
    renderAt("/operationen");
    await screen.findByTestId("nav-/guilds");
    expect(screen.queryByTestId("nav-/guilds/settings")).toBeNull();
  });
});

// ── 4. Persistent server context ─────────────────────────────────────────────
describe("IA — server context", () => {
  it("server-scoped links carry the active guild, plain links do not", () => {
    const settings = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.to === "/guilds/settings")!;
    const list = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.to === "/guilds")!;
    expect(navHref(settings, "guild_2")).toBe("/guilds/settings?guild=guild_2");
    expect(navHref(settings, null)).toBe("/guilds/settings");
    expect(navHref(list, "guild_2")).toBe("/guilds");
  });

  it("choosing a server in the rail rewrites the server links and survives navigation", async () => {
    useSession(sessionOperator);
    renderAt("/operationen");

    const picker = (await screen.findByTestId("nav-server-picker")) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: "guild_2" } });

    await waitFor(() => {
      expect(screen.getByTestId("nav-/guilds/settings")).toHaveAttribute("href", "/guilds/settings?guild=guild_2");
      expect(screen.getByTestId("nav-/guilds/fleet")).toHaveAttribute("href", "/guilds/fleet?guild=guild_2");
    });
    expect(window.localStorage.getItem("rdoc.fleetplanner.activeGuild")).toBe("guild_2");
  });

  it("a remembered server decides which one the settings screen opens", async () => {
    window.localStorage.setItem("rdoc.fleetplanner.activeGuild", "guild_2");
    useSession(sessionOperator);
    server.use(
      http.get(`${API}/guilds/:id/settings`, ({ params }) =>
        HttpResponse.json({
          guild: { id: String(params.id), name: String(params.id) === "guild_2" ? "Second Fleet" : "RDOC", orgName: "", timezone: "Europe/Berlin", discordInviteUrl: null, admiralRoleId: null, ownerUserId: "x", canRemove: false, landingOptIn: false },
          members: [],
        }),
      ),
    );
    renderAt("/guilds/settings");

    const select = (await screen.findByTestId("guild-select")) as HTMLSelectElement;
    expect(select.value).toBe("guild_2");
    // …and the page says which server it is talking about.
    const crumbs = await screen.findByTestId("breadcrumbs");
    expect(crumbs).toHaveTextContent("Second Fleet");
    expect(crumbs).toHaveTextContent("Server-Einstellungen");
  });

  it("a ?guild= deep link wins over the remembered server", async () => {
    window.localStorage.setItem("rdoc.fleetplanner.activeGuild", "guild_1");
    useSession(sessionOperator);
    server.use(
      http.get(`${API}/guilds/:id/diagnostics`, ({ params }) =>
        HttpResponse.json({
          guild: { id: String(params.id), name: String(params.id) === "guild_2" ? "Second Fleet" : "RDOC" },
          canInspectPermissions: false,
          summary: { ok: 0, warn: 0, error: 0 },
          bots: [],
        }),
      ),
    );
    renderAt("/guilds/diagnostics?guild=guild_2");

    const select = (await screen.findByTestId("diag-guild")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("guild_2"));
  });
});

// ── 5. Mobile navigation ─────────────────────────────────────────────────────
describe("IA — mobile navigation", () => {
  it("replaces the flat select with the same groups and gates as the rail", async () => {
    useSession(sessionOperator);
    renderAt("/operationen");

    expect(screen.queryByTestId("mobile-screen-select")).toBeNull();
    const toggle = await screen.findByTestId("mobile-nav-toggle");
    expect(screen.queryByTestId("mobile-nav-drawer")).toBeNull();

    fireEvent.click(toggle);
    const drawer = await screen.findByTestId("mobile-nav-drawer");

    // Same groups, same items, same action — one IA for both shells.
    for (const g of ["ops", "server", "konto", "help"]) {
      expect(screen.getByTestId(`mnav-group-${g}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("mnav-/ops/new")).toBeInTheDocument();
    expect(screen.getByTestId("mnav-/guilds/settings")).toBeInTheDocument();
    expect(drawer).toContainElement(screen.getByTestId("mnav-server-picker"));
  });

  it("applies the same gates as the rail (crew sees no server management)", async () => {
    useSession(sessionCrew);
    renderAt("/operationen");
    fireEvent.click(await screen.findByTestId("mobile-nav-toggle"));
    await screen.findByTestId("mobile-nav-drawer");
    expect(screen.getByTestId("mnav-/guilds")).toBeInTheDocument();
    expect(screen.queryByTestId("mnav-/guilds/settings")).toBeNull();
  });

  it("closes after navigating", async () => {
    useSession(sessionCrew);
    renderAt("/operationen");
    fireEvent.click(await screen.findByTestId("mobile-nav-toggle"));
    fireEvent.click(await screen.findByTestId("mnav-/handbuch"));
    await waitFor(() => expect(screen.queryByTestId("mobile-nav-drawer")).toBeNull());
  });
});

// ── 6. Grouping / labels / secondary surfaces ────────────────────────────────
describe("IA — grouping and labels", () => {
  it("templates live under Operationen", () => {
    const ops = NAV_GROUPS.find((g) => g.id === "ops")!;
    expect(ops.items.map((i) => i.to)).toContain("/templates");
  });

  it("feedback is help, not a second account entry", () => {
    const konto = NAV_GROUPS.find((g) => g.id === "konto")!;
    const help = NAV_GROUPS.find((g) => g.id === "help")!;
    expect(konto.items.map((i) => i.to)).toEqual(["/konto"]);
    expect(help.items.map((i) => i.to)).toContain("/konto/feedback");
  });

  it("API docs left the primary navigation for the developer foot", async () => {
    expect(NAV_GROUPS.flatMap((g) => g.items).map((i) => i.to)).not.toContain("/api-docs");
    useSession(sessionCrew);
    renderAt("/operationen");
    const dev = await screen.findByTestId("nav-developer");
    expect(dev).toContainElement(screen.getByTestId("nav-/api-docs"));
    expect(screen.getByTestId("nav-/api-docs").closest(".nav-group")).toBeNull();
  });

  it("uses the precise labels", async () => {
    useSession(sessionOperator);
    renderAt("/operationen");
    expect(await screen.findByTestId("nav-/guilds")).toHaveTextContent("Discord-Server");
    expect(screen.getByTestId("nav-/guilds/settings")).toHaveTextContent("Server-Einstellungen");
    expect(screen.getByTestId("nav-/ships")).toHaveTextContent("Schiffsdatenbank");
  });
});

// ── 7. URL-addressable operator console ──────────────────────────────────────
describe("IA — operator console tabs live in the URL", () => {
  const operatorView = {
    crewRequests: [], questions: [], hangarShares: [], auditLogs: [], requirements: [],
    eventInterests: [], cqbTeams: [], cqbSoldiers: [], formations: [], fighterSquads: [], assignablePeople: [],
  };
  const emptyNeeds = { shipTypes: [], cqbTeamMax: 8, cqbTeamDefault: 4, fighterSquadSize: 2, shipNeeds: [], fighterSquads: 0, cqbTeams: { count: 0, size: 4 }, requirements: [] };

  function operatorHandlers() {
    useSession(sessionCrew);
    server.use(
      http.get(`${API}/operations/op_1`, () => HttpResponse.json({ ...opDetailFixture, canManage: true })),
      http.get(`${API}/operations/op_1/operator`, () => HttpResponse.json(operatorView)),
      http.get(`${API}/operations/op_1/needs`, () => HttpResponse.json(emptyNeeds)),
      http.get(`${API}/operations/:id/squadlink`, () => HttpResponse.json({ enabled: false, configured: false, started: false, link: null, storeUrl: null })),
      http.get(`${API}/operations/:id/voice/recipients`, () => HttpResponse.json({ userIds: [] })),
    );
  }

  it("opens the work area that owns the deep-linked tab", async () => {
    operatorHandlers();
    // Commanders is a communication job, not a detail of the Eckdaten (§6).
    renderAt("/ops/op_1?op=commanders");
    expect(await screen.findByTestId("manage-tab-commanders")).toHaveAttribute("aria-selected", "true");
    // The work areas are a switcher, not a second tab level: pressed, not selected.
    expect(screen.getByTestId("manage-group-kommunikation")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("manage-group-flotte")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("manage-group-kommunikation")).not.toHaveAttribute("role", "tab");
    // Tabs of other areas are collapsed — nine flat tabs are gone.
    expect(screen.queryByTestId("manage-tab-fleet")).toBeNull();
  });

  it("selecting an area writes the tab into the URL and browser-back returns", async () => {
    operatorHandlers();
    renderAt("/ops/op_1?op=fleet");
    await screen.findByTestId("manage-tab-fleet");

    fireEvent.click(screen.getByTestId("manage-group-kommunikation"));
    expect(await screen.findByTestId("manage-tab-qa")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByTestId("probe-url")).toHaveTextContent("/ops/op_1?op=qa"));

    // History push, not replace: back lands on the previous work area again.
    fireEvent.click(screen.getByTestId("probe-back"));
    await waitFor(() => expect(screen.getByTestId("manage-group-flotte")).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByTestId("probe-url")).toHaveTextContent("/ops/op_1?op=fleet");
  });

  it("accepts the legacy tab aliases and an area name in ?op=", async () => {
    operatorHandlers();
    const { unmount } = renderAt("/ops/op_1?op=overview");
    expect(await screen.findByTestId("manage-tab-eckdaten")).toHaveAttribute("aria-selected", "true");
    unmount();

    operatorHandlers();
    const second = renderAt("/ops/op_1?op=verwaltung");
    expect(await screen.findByTestId("manage-tab-admin")).toHaveAttribute("aria-selected", "true");
    second.unmount();

    // The cover joined the other media in "Briefing & Medien". Every bookmark
    // and the /ops/:id/cover redirect still say ?op=cover, so it has to land.
    operatorHandlers();
    renderAt("/ops/op_1?op=cover");
    expect(await screen.findByTestId("manage-tab-briefing")).toHaveAttribute("aria-selected", "true");
  });

  it("the operation detail page offers a breadcrumb back to the list", async () => {
    useSession(sessionCrew);
    server.use(http.get(`${API}/operations/op_1`, () => HttpResponse.json(opDetailFixture)));
    renderAt("/ops/op_1");
    const back = await screen.findByTestId("breadcrumbs-back");
    expect(back).toHaveAttribute("href", "/operationen");
  });
});

// ── 6b. Viewing and managing are two modes of one route (§6) ─────────────────
describe("IA — an operation has a view mode and a manage mode", () => {
  const operatorView = {
    crewRequests: [], questions: [], hangarShares: [], auditLogs: [], requirements: [],
    eventInterests: [], cqbTeams: [], cqbSoldiers: [], formations: [], fighterSquads: [], assignablePeople: [],
  };
  const emptyNeeds = { shipTypes: [], cqbTeamMax: 8, cqbTeamDefault: 4, fighterSquadSize: 2, shipNeeds: [], fighterSquads: 0, cqbTeams: { count: 0, size: 4 }, requirements: [] };

  function manageableOp(canManage = true) {
    useSession(sessionCrew);
    server.use(
      http.get(`${API}/operations/op_1`, () => HttpResponse.json({ ...opDetailFixture, canManage })),
      http.get(`${API}/operations/op_1/operator`, () => HttpResponse.json(operatorView)),
      http.get(`${API}/operations/op_1/needs`, () => HttpResponse.json(emptyNeeds)),
      http.get(`${API}/operations/:id/squadlink`, () => HttpResponse.json({ enabled: false, configured: false, started: false, link: null, storeUrl: null })),
      http.get(`${API}/operations/:id/voice/recipients`, () => HttpResponse.json({ userIds: [] })),
    );
  }

  it("opens on the participant view, with the console out of the way", async () => {
    manageableOp();
    renderAt("/ops/op_1");
    // What a participant sees is what a manager sees first — the console used to
    // sit underneath all of it and had to be scrolled to.
    expect(await screen.findByTestId("join-card")).toBeInTheDocument();
    expect(screen.queryByTestId("operator-console")).toBeNull();
    expect(screen.getByTestId("op-mode-view")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("op-mode-manage")).toHaveAttribute("aria-pressed", "false");
  });

  it("switches to the workspace, records it in the URL, and Back returns", async () => {
    manageableOp();
    renderAt("/ops/op_1");
    fireEvent.click(await screen.findByTestId("op-mode-manage"));

    expect(await screen.findByTestId("operator-console")).toBeInTheDocument();
    expect(screen.queryByTestId("join-card")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("probe-url")).toHaveTextContent("/ops/op_1?mode=manage"));

    fireEvent.click(screen.getByTestId("probe-back"));
    expect(await screen.findByTestId("join-card")).toBeInTheDocument();
    expect(screen.getByTestId("probe-url")).toHaveTextContent("/ops/op_1");
  });

  it("a legacy ?op= deep link still lands in the workspace, on its tab", async () => {
    manageableOp();
    renderAt("/ops/op_1?op=commanders");
    expect(await screen.findByTestId("manage-tab-commanders")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("join-card")).toBeNull();
  });

  it("stays in the workspace when the operator changes tab", async () => {
    // Regression guard: the console used to strip `mode` from the URL along with
    // the tab aliases, which threw the operator back to the participant view on
    // the first tab click.
    manageableOp();
    renderAt("/ops/op_1?mode=manage");
    fireEvent.click(await screen.findByTestId("manage-group-kommunikation"));

    expect(await screen.findByTestId("manage-tab-qa")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByTestId("probe-url")).toHaveTextContent("mode=manage"));
    expect(screen.getByTestId("operator-console")).toBeInTheDocument();
  });

  it("returning to the view drops the tab, so a copied link is not a console link", async () => {
    manageableOp();
    renderAt("/ops/op_1?op=cqb");
    fireEvent.click(await screen.findByTestId("op-mode-view"));

    expect(await screen.findByTestId("join-card")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("probe-url")).toHaveTextContent("/ops/op_1"));
    expect(screen.getByTestId("probe-url")).not.toHaveTextContent("op=cqb");
  });

  it("a crew member gets no switch, and cannot conjure one from the URL", async () => {
    manageableOp(false);
    renderAt("/ops/op_1?mode=manage");
    expect(await screen.findByTestId("join-card")).toBeInTheDocument();
    expect(screen.queryByTestId("op-mode-manage")).toBeNull();
    expect(screen.queryByTestId("operator-console")).toBeNull();
  });

  it("the object header names the operation and its state in both modes", async () => {
    manageableOp();
    const { unmount } = renderAt("/ops/op_1");
    expect(await screen.findByTestId("op-title")).toHaveTextContent("Xenothreat Logistics");
    expect(screen.getByTestId("op-status-chip")).toHaveTextContent("Offen");
    expect(screen.getByTestId("op-kpi-seats")).toHaveTextContent("1/2 Plätze");
    unmount();

    manageableOp();
    renderAt("/ops/op_1?mode=manage");
    // Losing the title on the way into the workspace is exactly the "which
    // operation am I editing?" problem the header exists to answer (§19).
    expect(await screen.findByTestId("op-title")).toHaveTextContent("Xenothreat Logistics");
    expect(screen.getByTestId("op-status-chip")).toHaveTextContent("Offen");
  });

  it("counts open work for a manager, and says what it counts", async () => {
    useSession(sessionCrew);
    server.use(
      http.get(`${API}/operations/op_1`, () =>
        HttpResponse.json({
          ...opDetailFixture,
          canManage: true,
          units: [...opDetailFixture.units, { ...opDetailFixture.units[0], id: "unit_p", status: "pending", seats: [] }],
          questions: [{ id: "q1", asker: "Crew One", body: "Wann?", answer: null, answeredBy: null, createdAt: "2026-08-01T10:00:00.000Z" }],
        }),
      ),
    );
    renderAt("/ops/op_1");
    // One pending unit + one unanswered question — a bare "2" would be unreadable.
    expect(await screen.findByTestId("op-kpi-open-work")).toHaveTextContent("2 offene Aufgaben");
  });
});

// ── 7. An unusable ?guild= must not fight the fallback (review 2026-08-22) ───
describe("IA — server context rejects a guild the viewer is not in", () => {
  it("falls back to a real membership and canonicalises the URL", async () => {
    useSession(sessionOperator);
    server.use(
      http.get(`${API}/guilds/:id/settings`, ({ params }) =>
        HttpResponse.json({
          guild: { id: String(params.id), name: "RDOC", orgName: "RDOC", timezone: "Europe/Berlin", discordInviteUrl: null, admiralRoleId: null, ownerUserId: "x", canRemove: false },
          members: [],
        }),
      ),
    );
    renderAt("/guilds/settings?guild=guild_does_not_exist");

    // It settles on a guild the viewer actually manages...
    await waitFor(() => expect(screen.getByTestId("probe-url")).toHaveTextContent("guild=guild_1"));
    // ...and stays there instead of ping-ponging with the URL effect.
    const settled = screen.getByTestId("probe-url").textContent;
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.getByTestId("probe-url").textContent).toBe(settled);
    expect(settled).not.toContain("guild_does_not_exist");
    // ...and it says so rather than silently showing another server.
    expect(screen.getByTestId("server-scope-unknown")).toBeInTheDocument();
  });

  it("still honours a deep link into a guild the viewer IS in", async () => {
    useSession(sessionOperator);
    server.use(
      http.get(`${API}/guilds/:id/settings`, ({ params }) =>
        HttpResponse.json({
          guild: { id: String(params.id), name: "Second Fleet", orgName: "Second Fleet", timezone: "Europe/Berlin", discordInviteUrl: null, admiralRoleId: null, ownerUserId: "x", canRemove: false },
          members: [],
        }),
      ),
    );
    renderAt("/guilds/settings?guild=guild_2");
    await waitFor(() => expect(screen.getByTestId("probe-url")).toHaveTextContent("guild=guild_2"));
  });
});
