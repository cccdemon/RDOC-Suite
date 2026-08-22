import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { App } from "../App";
import { server } from "./setup";
import { opDetailFixture, opSummaryFixture, sessionCrew, sessionGuest } from "./fixtures";
import type { SessionResponse } from "../api/types";
import { btnGhost, btnPrimary } from "../components/ui";

// Card types (UI audit §8). Each type makes one promise; these tests pin the
// promises rather than the looks: one primary target per object tile, secondary
// actions that do not navigate, inert info cards, and destructive work that is
// never mixed into a routine row.
const API = "/fleetplanner/api/v1";

const sessionOperator: SessionResponse = {
  ...sessionCrew,
  memberships: [{ guildId: "guild_1", guildName: "RDOC", role: "fleetoperator" }],
};

const now = new Date();
const upcoming = {
  ...opSummaryFixture,
  scheduledAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0).toISOString(),
};

function Probe() {
  const loc = useLocation();
  return <span data-testid="probe-url">{loc.pathname + loc.search}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Probe />
    </MemoryRouter>,
  );
}

const url = () => screen.getByTestId("probe-url").textContent ?? "";

beforeEach(() => {
  window.localStorage.clear();
});

// ── object tile ──────────────────────────────────────────────────────────────
describe("object tile — exactly one primary target", () => {
  it("the whole operation tile is one link, and Discord is not it", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
      http.get(`${API}/operations`, () => HttpResponse.json({ operations: [upcoming] })),
    );
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderAt("/operationen?view=liste");

    const tile = await screen.findByTestId("op-card");
    expect(tile).toHaveAttribute("data-card", "object");
    expect(tile.tagName).toBe("A");
    expect(tile).toHaveAttribute("href", "/ops/op_1");
    // Exactly one primary target: no second link nested inside the tile.
    expect(tile.querySelectorAll("a").length).toBe(0);

    // The secondary action does its own thing and leaves the page alone.
    fireEvent.click(screen.getByTestId("discord-join"));
    expect(open).toHaveBeenCalled();
    expect(url()).toBe("/operationen?view=liste");
    open.mockRestore();
  });

  it("a poll tile follows the same contract", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
      http.get(`${API}/polls`, () =>
        HttpResponse.json({
          polls: [{
            id: "poll_1", title: "Wann fliegen wir?", description: null, status: "open",
            visibility: "guild", mode: "single", maxChoices: null, optionCount: 2, totalVotes: 0,
            anonymous: false, resultsVisibility: "always", viewerHasVoted: false,
            createdBy: { id: "user_crew", username: "Crew One" },
            closesAt: null, createdAt: new Date().toISOString(), guild: { id: "guild_1", name: "RDOC" },
          }],
        }),
      ),
    );
    renderAt("/polls");
    const tile = await screen.findByTestId("poll-card-poll_1");
    expect(tile).toHaveAttribute("data-card", "object");
    expect(tile).toHaveAttribute("href", "/polls/poll_1");
  });
});

// ── choice tile ──────────────────────────────────────────────────────────────
describe("choice tile — a selection, not a destination", () => {
  it("mission type and visibility report their pressed state", async () => {
    server.use(http.get(`${API}/session`, () => HttpResponse.json(sessionOperator)));
    server.use(http.get(`${API}/guilds/:id/partnerships`, () => HttpResponse.json({ partnerships: [] })));
    renderAt("/ops/new");

    const combat = await screen.findByTestId("wiz-type-combat");
    expect(combat).toHaveAttribute("data-card", "choice");
    expect(combat).toHaveAttribute("aria-pressed", "true");

    const mining = screen.getByTestId("wiz-type-mining");
    expect(mining).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(mining);
    await waitFor(() => expect(mining).toHaveAttribute("aria-pressed", "true"));
    expect(combat).toHaveAttribute("aria-pressed", "false");
    // A choice never navigates.
    expect(url()).toBe("/ops/new");
  });
});

// ── info card ────────────────────────────────────────────────────────────────
describe("info card — says something, does nothing", () => {
  it("roadmap entries are typed as info and carry no action", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
      http.get(`${API}/roadmap`, () =>
        HttpResponse.json({ items: [{ id: "r1", title: "Org-Modul", status: "planned", body: "…", sortOrder: 0 }] }),
      ),
    );
    renderAt("/handbuch/roadmap");
    const cards = await waitFor(() => {
      const found = document.querySelectorAll('[data-card="info"]');
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    cards.forEach((c) => {
      expect(c.tagName).not.toBe("A");
      expect(c.tagName).not.toBe("BUTTON");
      expect(c).not.toHaveAttribute("href");
    });
  });
});

// ── danger zone ──────────────────────────────────────────────────────────────
describe("danger zone — kept away from the routine controls", () => {
  it("deleting an operation lives in its own typed zone", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionOperator)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json({ ...opDetailFixture, canManage: true })),
    );
    renderAt("/ops/op_1?op=danger");

    const zone = await screen.findByTestId("op-danger-zone");
    expect(zone).toHaveAttribute("data-card", "danger");
    expect(zone).toContainElement(screen.getByTestId("op-delete"));
    // and nothing routine shares the box
    expect(zone.querySelectorAll("input, select").length).toBe(0);
  });

  it("will not delete until the operation's name has been typed out", async () => {
    const deleted = vi.fn();
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionOperator)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json({ ...opDetailFixture, canManage: true })),
      http.delete(`${API}/operations/op_1`, () => { deleted(); return HttpResponse.json({ ok: true }); }),
    );
    renderAt("/ops/op_1?op=danger");

    fireEvent.click(await screen.findByTestId("op-delete"));
    // Armed, but a confirm button on its own is muscle memory.
    expect(screen.getByTestId("op-delete-confirm")).toBeDisabled();

    fireEvent.change(screen.getByTestId("op-delete-name"), { target: { value: "Xenothreat" } });
    expect(screen.getByTestId("op-delete-confirm")).toBeDisabled();

    fireEvent.change(screen.getByTestId("op-delete-name"), { target: { value: "Xenothreat Logistics" } });
    fireEvent.click(screen.getByTestId("op-delete-confirm"));
    await waitFor(() => expect(deleted).toHaveBeenCalled());
  });

  it("keeps the reversible endings out of the irreversible box", async () => {
    const status = vi.fn();
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionOperator)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json({ ...opDetailFixture, canManage: true })),
      http.post(`${API}/operations/op_1/status`, async ({ request }) => {
        const body = (await request.json()) as { status: string };
        status(body.status);
        return HttpResponse.json({ ok: true, status: body.status });
      }),
    );
    renderAt("/ops/op_1?op=danger");

    // Ending and cancelling are status changes and stay outside the danger zone.
    const zone = await screen.findByTestId("op-danger-zone");
    const closeout = screen.getByTestId("op-closeout");
    expect(zone).not.toContainElement(closeout);

    fireEvent.click(screen.getByTestId("op-complete"));
    await waitFor(() => expect(status).toHaveBeenCalledWith("completed"));

    fireEvent.click(screen.getByTestId("op-cancel"));
    await waitFor(() => expect(status).toHaveBeenCalledWith("cancelled"));
  });

  it("does not offer to cancel an operation that is already cancelled", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionOperator)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json({ ...opDetailFixture, canManage: true, status: "cancelled" })),
    );
    renderAt("/ops/op_1?op=danger");

    expect(await screen.findByTestId("op-cancel")).toBeDisabled();
    expect(screen.getByTestId("op-cancel")).toHaveTextContent("Bereits abgesagt");
  });
});

// ── tables ───────────────────────────────────────────────────────────────────
describe("tables scroll instead of squeezing", () => {
  it("the ship database keeps a readable minimum width", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
      http.get(`${API}/ships/search`, () =>
        HttpResponse.json({
          ships: [{ id: "sh1", name: "Perseus", manufacturer: "RSI", size: "large", role: "combat", minCrew: 2, maxCrew: 4, imageUrl: null, sourceUrl: null }],
        }),
      ),
    );
    renderAt("/ships");
    const table = await screen.findByTestId("ships-table");
    expect(table.className).toContain("fpw-table");
    expect(table).toHaveAttribute("data-card", "work");
  });
});

// ── one vocabulary for the state (§8) ────────────────────────────────────────
describe("status badges say the same thing everywhere", () => {
  it("the list tile shows the German status, not the raw enum", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
      http.get(`${API}/operations`, () =>
        HttpResponse.json({ operations: [{ ...upcoming, status: "open", visibility: "public", filledSeats: 1, totalSeats: 4 }] }),
      ),
    );
    renderAt("/operationen?view=liste");

    const badge = await screen.findByTestId("op-card-status");
    expect(badge).toHaveTextContent("OFFEN");
    expect(screen.queryByText("open")).not.toBeInTheDocument();
    expect(screen.getByText("ÖFFENTLICH")).toBeInTheDocument();
    // capacity belongs on the tile (§5 information order)
    expect(screen.getByText(/1\/4 PLÄTZE/)).toBeInTheDocument();
  });

  it("a full operation reads as VOLL in the list too", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
      http.get(`${API}/operations`, () =>
        HttpResponse.json({ operations: [{ ...upcoming, status: "open", filledSeats: 4, totalSeats: 4 }] }),
      ),
    );
    renderAt("/operationen?view=liste");
    expect(await screen.findByTestId("op-card-status")).toHaveTextContent("VOLL");
  });
});

// ── §10.3 / §10.4: the card is typed, and the ranks are told apart ───────────
describe("surface and action vocabulary", () => {
  // styles.css styles on [data-card="…"], so an unknown value is a card that
  // silently gets no type at all.
  const ALLOWED = ["object", "choice", "info", "work", "form", "danger"];

  function useOperatorOp(over: Record<string, unknown> = {}) {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionOperator)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json({ ...opDetailFixture, canManage: true, ...over })),
    );
  }

  it("every typed surface uses a type the stylesheet knows", async () => {
    useOperatorOp();
    const { container } = renderAt("/ops/op_1?op=danger");
    await screen.findByTestId("op-danger-zone");

    const used = [...container.querySelectorAll("[data-card]")].map((el) => el.getAttribute("data-card"));
    expect(used.length).toBeGreaterThan(0);
    for (const t of used) expect(ALLOWED).toContain(t);
  });

  it("the management sub-views say which kind of surface they are", async () => {
    useOperatorOp();
    renderAt("/ops/op_1?op=danger");
    // Two status changes that can be undone: work, not danger.
    expect(await screen.findByTestId("op-closeout")).toHaveAttribute("data-card", "work");
    expect(screen.getByTestId("op-danger-zone")).toHaveAttribute("data-card", "danger");
  });

  it("an explanation is not dressed as something to operate", async () => {
    useOperatorOp();
    server.use(http.get(`${API}/guilds/guild_1/partnerships`, () => HttpResponse.json({ partnerships: [] })));
    renderAt("/ops/op_1?op=freigabe");
    // The status card tells you what the state means; there is nothing to press.
    expect(await screen.findByTestId("release-status")).toHaveAttribute("data-card", "info");
  });

  it("the primary action is distinguishable from the quiet one without reading it", () => {
    // These two used to differ by an outline colour only — both monospace, both
    // the same weight. On a panel with six controls that is not a hierarchy.
    expect(btnPrimary.background).not.toBe(btnGhost.background);
    expect(btnPrimary.color).not.toBe(btnGhost.color);
    expect(btnPrimary.fontWeight).not.toBe(btnGhost.fontWeight);
  });

  it("labels on buttons are body type, not monospace (§10.1)", () => {
    // Monospace is for status, time, IDs and short eyebrows. "Operation
    // erstellen" is a sentence a person reads.
    expect(btnPrimary.fontFamily).toBe("var(--body)");
    expect(btnGhost.fontFamily).toBe("var(--body)");
  });
});
