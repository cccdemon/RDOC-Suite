import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { OperatorPanel } from "../components/OperatorPanel";
import { FieldSaveProvider } from "../components/fieldSave";
import { server } from "./setup";
import { opDetailFixture } from "./fixtures";
import type { OperationDetail, OperatorView } from "../api/types";

// Crew→seat drag-and-drop, per UI audit §7 + the acceptance list in §14. These
// pin the INTERACTION MODEL: valid/invalid targets, the pending lock, rollback,
// Escape, and the fact that mouse, keyboard and click paths do the same thing.
const API = "/fleetplanner/api/v1";

// seat_1 = captain seat, taken by "Lead". seat_2 = free Gunner seat. seat_3 =
// deactivated, so it must never accept a drop.
const boardOp: OperationDetail = {
  ...opDetailFixture,
  canManage: true,
  units: [
    {
      ...opDetailFixture.units[0],
      seats: [
        ...opDetailFixture.units[0].seats,
        { id: "seat_3", label: "Turret", order: 2, active: false, claimedBy: null, lateEta: null },
      ],
    },
  ],
};

const operatorView: OperatorView = {
  crewRequests: [
    { userId: "user_flex", username: "Alex", note: "kann alles", createdAt: "2026-06-01T10:00:00.000Z" },
    { userId: "user_partner", username: "Nova", note: null, createdAt: "2026-06-01T11:00:00.000Z" },
  ],
  questions: [],
  hangarShares: [],
  auditLogs: [],
  requirements: [],
  eventInterests: [],
  cqbTeams: [],
  cqbSoldiers: [],
  formations: [],
  fighterSquads: [],
  assignablePeople: [
    { userId: "user_flex", username: "Alex", guildId: "guild_1", guildName: "RDOC", isHost: true },
    { userId: "user_partner", username: "Nova", guildId: "guild_9", guildName: "Void Corp", isHost: false },
  ],
};

function useView(view: OperatorView = operatorView) {
  server.use(http.get(`${API}/operations/:id/operator`, () => HttpResponse.json(view)));
}

function renderBoard(onError = vi.fn(), onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <FieldSaveProvider>
        <OperatorPanel op={boardOp} csrf="csrf-test-token" onChanged={onChanged} onError={onError} embedded section="fleet" />
      </FieldSaveProvider>
    </MemoryRouter>,
  );
  return { onError, onChanged };
}

// A drag needs a dataTransfer stand-in; jsdom does not build one.
function dataTransfer() {
  const store: Record<string, string> = {};
  return {
    effectAllowed: "",
    setData: (k: string, v: string) => { store[k] = v; },
    getData: (k: string) => store[k] ?? "",
  };
}

beforeEach(() => {
  useView();
});

async function board() {
  await screen.findByTestId("operator-panel");
}

// ── valid target ─────────────────────────────────────────────────────────────
describe("board drag-and-drop — valid target", () => {
  it("drops a flexible person on a free active seat and saves it", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${API}/operations/op_1/seats/seat_2/assignment`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderBoard();
    await board();

    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId("op-flex-user_flex"), { dataTransfer: dt });
    const seat = screen.getByTestId("op-target-seat_2");
    fireEvent.dragOver(seat, { dataTransfer: dt });

    // Hovering a valid target names person AND destination (§7.2).
    expect(screen.getByTestId("op-drop-hint-seat_2")).toHaveTextContent(/Alex auf Gunner setzen/);

    fireEvent.drop(seat, { dataTransfer: dt });
    await waitFor(() => expect(body).toEqual({ userId: "user_flex" }));

    // Success: person sits at the seat, leaves "Flexibel", live region confirms.
    expect(within(seat).getByText("Alex")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("op-flex-user_flex")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("board-live")).toHaveTextContent(/Alex auf Gunner eingeteilt/));
  });

  it("announces the pending state and refuses a second drop while saving", async () => {
    let calls = 0;
    server.use(
      http.put(`${API}/operations/op_1/seats/seat_2/assignment`, async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 40));
        return HttpResponse.json({ ok: true });
      }),
    );
    renderBoard();
    await board();

    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId("op-flex-user_flex"), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("op-target-seat_2"), { dataTransfer: dt });

    expect(screen.getByTestId("board-live")).toHaveTextContent(/wird gespeichert/);
    // The seat is filled optimistically, so it is no longer a target at all.
    expect(screen.queryByTestId("op-target-seat_2")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("board-live")).toHaveTextContent(/eingeteilt/));
    expect(calls).toBe(1);
  });
});

// ── invalid targets ──────────────────────────────────────────────────────────
describe("board drag-and-drop — invalid targets", () => {
  it("neither an occupied nor a deactivated seat is a drop target", async () => {
    renderBoard();
    await board();
    expect(screen.queryByTestId("op-target-seat_1")).not.toBeInTheDocument(); // taken
    expect(screen.queryByTestId("op-target-seat_3")).not.toBeInTheDocument(); // inactive
  });

  it("a deactivated seat explains itself instead of staying silent", async () => {
    let calls = 0;
    server.use(http.put(`${API}/operations/op_1/seats/:seat/assignment`, () => { calls += 1; return HttpResponse.json({ ok: true }); }));
    renderBoard();
    await board();

    fireEvent.click(screen.getByTestId("op-place-user_flex"));
    const dead = screen.getByTitle("Sitz ist deaktiviert");
    fireEvent.click(dead);

    expect(screen.getByTestId("board-live")).toHaveTextContent(/Sitz ist deaktiviert/);
    expect(calls).toBe(0);
  });
});

// ── error handling ───────────────────────────────────────────────────────────
describe("board drag-and-drop — failure", () => {
  it("rolls the board back and reports the error at the seat", async () => {
    server.use(
      http.put(`${API}/operations/op_1/seats/seat_2/assignment`, () =>
        HttpResponse.json({ error: { code: "conflict", message: "Sitz bereits vergeben.", requestId: "r" } }, { status: 409 }),
      ),
    );
    const onError = vi.fn();
    renderBoard(onError);
    await board();

    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId("op-flex-user_flex"), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("op-target-seat_2"), { dataTransfer: dt });

    await waitFor(() => expect(screen.getByTestId("op-seat-error-seat_2")).toHaveTextContent("Sitz bereits vergeben."));
    expect(onError).toHaveBeenCalledWith("Sitz bereits vergeben.");
    expect(screen.getByTestId("board-live")).toHaveTextContent(/Fehler/);
    // Rolled back: the seat is free again and takes a new attempt.
    await waitFor(() => expect(screen.getByTestId("op-target-seat_2")).toBeInTheDocument());
  });
});

// ── the non-drag paths ───────────────────────────────────────────────────────
describe("board — click, keyboard and cancel do the same work", () => {
  it("places a person via Einteilen → seat click", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${API}/operations/op_1/seats/seat_2/assignment`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderBoard();
    await board();

    fireEvent.click(screen.getByTestId("op-place-user_flex"));
    fireEvent.click(screen.getByTestId("op-target-seat_2"));
    await waitFor(() => expect(body).toEqual({ userId: "user_flex" }));
  });

  it("places a person with the keyboard alone", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${API}/operations/op_1/seats/seat_2/assignment`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderBoard();
    await board();

    fireEvent.click(screen.getByTestId("op-place-user_partner"));
    const seat = screen.getByTestId("op-target-seat_2");
    expect(seat).toHaveAttribute("tabindex", "0");
    expect(seat).toHaveAttribute("aria-label", expect.stringContaining("Nova auf Gunner setzen"));
    seat.focus();
    fireEvent.keyDown(seat, { key: "Enter" });
    await waitFor(() => expect(body).toEqual({ userId: "user_partner" }));
  });

  it("Escape leaves place mode without assigning", async () => {
    let calls = 0;
    server.use(http.put(`${API}/operations/op_1/seats/:seat/assignment`, () => { calls += 1; return HttpResponse.json({ ok: true }); }));
    renderBoard();
    await board();

    fireEvent.click(screen.getByTestId("op-place-user_flex"));
    expect(screen.getByTestId("op-place-user_flex")).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.getByTestId("op-place-user_flex")).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByTestId("board-live")).toHaveTextContent(/abgebrochen/i);
    fireEvent.click(screen.getByTestId("op-target-seat_2")); // opens the picker, assigns nothing
    expect(calls).toBe(0);
  });
});

// ── grouping rules ───────────────────────────────────────────────────────────
describe("board — grouping rules stay visible", () => {
  it("keeps the partner org on the waiting person and marks the captain seat", async () => {
    renderBoard();
    await board();
    expect(screen.getByTestId("op-flex-origin-user_partner")).toHaveTextContent("VOID CORP");
    expect(screen.queryByTestId("op-flex-origin-user_flex")).not.toBeInTheDocument(); // host member
    expect(screen.getByTestId("op-seat-captain-seat_1")).toBeInTheDocument();
  });

  it("marks an already seated person as an additional assignment", async () => {
    useView({
      ...operatorView,
      crewRequests: [{ userId: "user_lead", username: "Lead", note: null, createdAt: "2026-06-01T10:00:00.000Z" }],
    });
    renderBoard();
    await board();

    expect(screen.getByTestId("op-flex-seated-user_lead")).toBeInTheDocument();
    expect(screen.getByTestId("op-place-user_lead")).toHaveTextContent("Zusätzlich");
    fireEvent.click(screen.getByTestId("op-place-user_lead"));
    expect(screen.getByTestId("op-target-seat_2")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("zusätzlich einteilen"),
    );
  });
});
