import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { App } from "../App";
import { server } from "./setup";
import { opSummaryFixture, sessionGuest } from "./fixtures";

// Operations overview + tab semantics (UI audit §5 and §9). These pin that the
// screen is reproducible from its URL and that every tab strip is a real tablist.
const API = "/fleetplanner/api/v1";

const now = new Date();
const at = (day: number, hour: number, minute = 0) =>
  new Date(now.getFullYear(), now.getMonth(), day, hour, minute, 0).toISOString();

const upcoming = { ...opSummaryFixture, id: "op_up", title: "Kommende Op", opType: "combat", scheduledAt: at(now.getDate(), 23, 59) };
const mining = { ...opSummaryFixture, id: "op_min", title: "Mining Op", opType: "mining", scheduledAt: at(now.getDate(), 23, 58) };
const streamOp = { ...opSummaryFixture, id: "op_str", title: "Stream Op", opType: "combat", isStreamEvent: true, scheduledAt: at(now.getDate(), 23, 57) };
const past = { ...opSummaryFixture, id: "op_past", title: "Vergangene Op", opType: "combat", scheduledAt: at(now.getDate(), 0, 1) };

function useOps(ops: unknown[]) {
  server.use(
    http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
    http.get(`${API}/operations`, () => HttpResponse.json({ operations: ops })),
  );
}

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

const url = () => screen.getByTestId("probe-url").textContent ?? "";

beforeEach(() => {
  window.localStorage.clear();
});

// ── the URL is the state ─────────────────────────────────────────────────────
describe("overview — view and filters live in the URL", () => {
  it("a deep link opens the named view, and Back restores the previous one", async () => {
    useOps([upcoming]);
    renderAt("/operationen?view=liste");
    await screen.findByTestId("op-grid");

    fireEvent.click(screen.getByTestId("cal-view-agenda"));
    await waitFor(() => expect(url()).toContain("view=agenda"));

    fireEvent.click(screen.getByTestId("probe-back"));
    await waitFor(() => expect(url()).toContain("view=liste"));
    expect(await screen.findByTestId("op-grid")).toBeInTheDocument();
  });

  it("the type filter is written to the URL and applied from it", async () => {
    useOps([upcoming, mining]);
    renderAt("/operationen?view=liste");
    await screen.findByTestId("op-grid");

    fireEvent.click(screen.getByTestId("cal-filter-mining"));
    await waitFor(() => expect(url()).toContain("typ=mining"));
    await waitFor(() => expect(screen.queryByText("Kommende Op")).not.toBeInTheDocument());
    expect(screen.getByText("Mining Op")).toBeInTheDocument();

    // "alle" clears the parameter instead of writing a default into the URL.
    fireEvent.click(screen.getByTestId("cal-filter-alle"));
    await waitFor(() => expect(url()).not.toContain("typ="));
  });

  it("applies the type filter from a cold deep link", async () => {
    useOps([upcoming, mining]);
    renderAt("/operationen?view=liste&typ=mining");
    await screen.findByTestId("op-grid");
    expect(screen.getByText("Mining Op")).toBeInTheDocument();
    expect(screen.queryByText("Kommende Op")).not.toBeInTheDocument();
  });

  it("the stream filter is a named choice and round-trips through the URL", async () => {
    useOps([upcoming, streamOp]);
    renderAt("/operationen?view=liste");
    await screen.findByTestId("op-grid");

    const select = screen.getByTestId("cal-filter-stream") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    fireEvent.change(select, { target: { value: "only" } });

    await waitFor(() => expect(url()).toContain("stream=only"));
    await waitFor(() => expect(screen.queryByText("Kommende Op")).not.toBeInTheDocument());
    expect(screen.getByText("Stream Op")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("cal-filter-stream"), { target: { value: "off" } });
    await waitFor(() => expect(screen.queryByText("Stream Op")).not.toBeInTheDocument());
    expect(screen.getByText("Kommende Op")).toBeInTheDocument();
  });

  it("past operations stay hidden until ?past=1", async () => {
    useOps([upcoming, past]);
    renderAt("/operationen?view=liste");
    await screen.findByTestId("op-grid");
    expect(screen.queryByText("Vergangene Op")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("cal-toggle-past"));
    await waitFor(() => expect(url()).toContain("past=1"));
    expect(await screen.findByText("Vergangene Op")).toBeInTheDocument();
  });

  it("the visible month and the selected day are addressable", async () => {
    useOps([upcoming]);
    renderAt("/operationen?view=kalender");
    await screen.findByTestId("calendar-page");

    fireEvent.click(screen.getByTestId("cal-next"));
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const expected = `m=${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    await waitFor(() => expect(url()).toContain(expected));

    fireEvent.click(screen.getByTestId("cal-today"));
    await waitFor(() => expect(url()).toContain(`d=${now.getDate()}`));

    fireEvent.click(screen.getByTestId("cal-day-15"));
    await waitFor(() => expect(url()).toContain("d=15"));
  });
});

// ── tab semantics ────────────────────────────────────────────────────────────
describe("overview — the view switch is a real tablist", () => {
  it("exposes tab roles, selection and a controlled panel", async () => {
    useOps([upcoming]);
    renderAt("/operationen?view=liste");
    await screen.findByTestId("op-grid");

    const list = screen.getByTestId("op-view-tabs");
    expect(list).toHaveAttribute("role", "tablist");
    const tab = screen.getByTestId("op-view-liste");
    expect(tab).toHaveAttribute("role", "tab");
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab).toHaveAttribute("aria-controls", "op-view-panel");
    expect(screen.getByTestId("cal-view-agenda")).toHaveAttribute("aria-selected", "false");
    expect(document.getElementById("op-view-panel")).toHaveAttribute("role", "tabpanel");
  });

  it("moves with the arrow keys", async () => {
    useOps([upcoming]);
    renderAt("/operationen?view=liste");
    await screen.findByTestId("op-grid");

    fireEvent.keyDown(screen.getByTestId("op-view-liste"), { key: "ArrowRight" });
    await waitFor(() => expect(url()).toContain("view=kalender"));

    fireEvent.keyDown(screen.getByTestId("cal-view-monat"), { key: "End" });
    await waitFor(() => expect(url()).toContain("view=agenda"));
  });
});

// ── empty state ──────────────────────────────────────────────────────────────
describe("overview — the empty state explains itself", () => {
  it("names the active filters and offers a reset", async () => {
    useOps([upcoming]);
    renderAt("/operationen?view=liste&typ=mining&stream=only");
    const empty = await screen.findByTestId("cal-empty");

    expect(within(empty).getByTestId("cal-empty-filters")).toHaveTextContent(/Mining/);
    expect(within(empty).getByTestId("cal-empty-filters")).toHaveTextContent(/nur Stream-Events/);

    fireEvent.click(screen.getByTestId("cal-filter-reset"));
    await waitFor(() => expect(url()).not.toContain("typ="));
    expect(url()).not.toContain("stream=");
    expect(await screen.findByTestId("op-grid")).toBeInTheDocument();
  });

  it("offers the past operations when that is what is hiding them", async () => {
    useOps([past]);
    renderAt("/operationen?view=liste");
    await screen.findByTestId("cal-empty");

    fireEvent.click(screen.getByTestId("cal-show-past-inline"));
    await waitFor(() => expect(url()).toContain("past=1"));
    expect(await screen.findByText("Vergangene Op")).toBeInTheDocument();
  });
});

// ── the same semantics everywhere ────────────────────────────────────────────
describe("Konto and Rechtliches use the same tab model", () => {
  it("Rechtliches tabs are links with tab semantics and arrow-key movement", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionGuest)),
      http.get(`${API}/docs/:slug`, () => HttpResponse.json({ slug: "lizenz", title: "Lizenz", html: "<p>x</p>" })),
    );
    renderAt("/rechtliches/lizenz");
    const tab = await screen.findByTestId("rechtliches-sec-lizenz");

    expect(tab).toHaveAttribute("role", "tab");
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab).toHaveAttribute("aria-controls", "rechtliches-panel");
    expect(tab).toHaveAttribute("aria-current", "page");
    expect(document.getElementById("rechtliches-panel")).toHaveAttribute("role", "tabpanel");

    fireEvent.keyDown(tab, { key: "ArrowRight" });
    await waitFor(() => expect(url()).toContain("/rechtliches/"));
    await waitFor(() => expect(url()).not.toContain("/rechtliches/lizenz"));
  });
});
