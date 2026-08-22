import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { App } from "../App";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { SquadLinkPanel } from "../components/SquadLinkPanel";
import { VoicePanel } from "../components/VoicePanel";
import { NeedsEditor } from "../components/NeedsEditor";
import { OperatorPanel } from "../components/OperatorPanel";
import { FieldSaveProvider } from "../components/fieldSave";
import { server } from "./setup";
import { opDetailFixture, sessionCrew } from "./fixtures";
import type { OperationDetail, OperatorView } from "../api/types";

// Redesign phase 0.4 — see docs/UI-UX-REDESIGN-MATRIX.md §6.1.
//
// These controls are reachable today and the redesign moves every one of them to
// a different place. None of them had a test in either layer, so a move could
// have dropped them silently. Each test pins the OPERATING PATH — which control
// the user touches and which request that produces — not the internal layout, so
// the test survives the move it is guarding.

const API = "/fleetplanner/api/v1";
const NOW = "2026-08-22T10:00:00.000Z";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

// ── 1. Streams on the operation detail page (moves to "Ansehen › Streams") ────

describe("preserved — streams on the operation", () => {
  const streamOp: OperationDetail = { ...opDetailFixture, isStreamEvent: true };

  function useStreamOp(op: OperationDetail = streamOp) {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(op)),
    );
  }

  it("a signed-in viewer can open the form and add a stream", async () => {
    useStreamOp();
    const posted = vi.fn();
    server.use(
      http.post(`${API}/operations/op_1/streams`, async ({ request }) => {
        posted(await request.json());
        return HttpResponse.json({
          ok: true,
          stream: { id: "st_1", platform: "twitch", url: "https://twitch.tv/rdoc", label: "Main", userId: "user_crew", username: "Crew One" },
        });
      }),
    );
    renderAt("/ops/op_1");

    // The form is closed until asked for — the opener is the entry point.
    fireEvent.click(await screen.findByTestId("op-stream-open"));

    fireEvent.change(screen.getByTestId("op-stream-platform"), { target: { value: "twitch" } });
    fireEvent.change(screen.getByTestId("op-stream-url"), { target: { value: "https://twitch.tv/rdoc" } });
    fireEvent.change(screen.getByTestId("op-stream-label"), { target: { value: "Main" } });
    fireEvent.click(screen.getByTestId("op-stream-add"));

    await waitFor(() => expect(posted).toHaveBeenCalledWith({ platform: "twitch", url: "https://twitch.tv/rdoc", label: "Main" }));
  });

  it("refuses to send an empty url instead of posting a broken stream", async () => {
    useStreamOp();
    const posted = vi.fn();
    server.use(http.post(`${API}/operations/op_1/streams`, () => { posted(); return HttpResponse.json({ ok: true }); }));
    renderAt("/ops/op_1");

    fireEvent.click(await screen.findByTestId("op-stream-open"));
    expect(screen.getByTestId("op-stream-add")).toBeDisabled();
    fireEvent.click(screen.getByTestId("op-stream-add"));
    expect(posted).not.toHaveBeenCalled();
  });

  it("shows an existing stream and lets its owner remove it", async () => {
    useStreamOp({
      ...streamOp,
      streams: [{ id: "st_9", platform: "twitch", url: "https://twitch.tv/rdoc", label: "Main", userId: "user_crew", username: "rdoc" }],
    });
    const deleted = vi.fn();
    server.use(http.delete(`${API}/operations/op_1/streams/st_9`, () => { deleted(); return HttpResponse.json({ ok: true }); }));
    renderAt("/ops/op_1");

    expect(await screen.findByTestId("op-stream-st_9")).toHaveTextContent("Main");
    fireEvent.click(screen.getByTestId("op-stream-del-st_9"));
    await waitFor(() => expect(deleted).toHaveBeenCalled());
  });

  it("hides the delete button on somebody else's stream", async () => {
    useStreamOp({
      ...streamOp,
      streams: [{ id: "st_8", platform: "youtube", url: "https://youtu.be/x", label: "Cast", userId: "user_other", username: "Someone" }],
    });
    renderAt("/ops/op_1");

    expect(await screen.findByTestId("op-stream-st_8")).toBeInTheDocument();
    expect(screen.queryByTestId("op-stream-del-st_8")).not.toBeInTheDocument();
  });
});

// ── 2. Documents (moves from the participant view to Planung › Briefing) ──────

describe("preserved — operation documents", () => {
  const pdf = () => new File(["%PDF-1.4"], "briefing.pdf", { type: "application/pdf" });

  function renderPanel(props: Partial<React.ComponentProps<typeof DocumentsPanel>> = {}) {
    const onNotice = vi.fn();
    render(<DocumentsPanel opId="op_1" csrf="csrf-test-token" canManage onNotice={onNotice} {...props} />);
    return { onNotice };
  }

  it("stays out of the way for a viewer who can neither manage nor read anything", () => {
    render(<DocumentsPanel opId="op_1" csrf={null} canManage={false} />);
    expect(screen.queryByTestId("documents-panel")).not.toBeInTheDocument();
  });

  it("shows an existing document to a plain viewer, without the manage controls", () => {
    render(
      <DocumentsPanel
        opId="op_1"
        csrf={null}
        canManage={false}
        initialDocs={[{ id: "doc_1", filename: "briefing.pdf", size: 2048, createdAt: NOW }]}
      />,
    );
    expect(screen.getByTestId("doc-link-doc_1")).toHaveTextContent("briefing.pdf");
    expect(screen.queryByTestId("doc-upload")).not.toBeInTheDocument();
    expect(screen.queryByTestId("doc-del-doc_1")).not.toBeInTheDocument();
  });

  it("uploads a picked PDF and lists it", async () => {
    const uploaded = vi.fn();
    server.use(
      http.post(`${API}/operations/op_1/documents`, () => {
        uploaded();
        return HttpResponse.json({ ok: true, document: { id: "doc_2", filename: "briefing.pdf", size: 9, createdAt: NOW } });
      }),
    );
    renderPanel();

    fireEvent.change(screen.getByTestId("doc-input"), { target: { files: [pdf()] } });

    await waitFor(() => expect(uploaded).toHaveBeenCalled());
    expect(await screen.findByTestId("doc-link-doc_2")).toHaveTextContent("briefing.pdf");
  });

  it("rejects a non-PDF in the browser instead of asking the server", async () => {
    const uploaded = vi.fn();
    server.use(http.post(`${API}/operations/op_1/documents`, () => { uploaded(); return HttpResponse.json({ ok: true }); }));
    const { onNotice } = renderPanel();

    fireEvent.change(screen.getByTestId("doc-input"), {
      target: { files: [new File(["x"], "plan.txt", { type: "text/plain" })] },
    });

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("Nur PDF-Dateien sind erlaubt."));
    expect(uploaded).not.toHaveBeenCalled();
  });

  it("deletes a document and drops it from the list", async () => {
    const deleted = vi.fn();
    server.use(http.delete(`${API}/operations/op_1/documents/doc_3`, () => { deleted(); return HttpResponse.json({ ok: true }); }));
    renderPanel({ initialDocs: [{ id: "doc_3", filename: "rules.pdf", size: 100, createdAt: NOW }] });

    fireEvent.click(screen.getByTestId("doc-del-doc_3"));

    await waitFor(() => expect(deleted).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("doc-link-doc_3")).not.toBeInTheDocument());
  });

  it("stops offering the upload once the five-file ceiling is reached", () => {
    renderPanel({
      initialDocs: Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, filename: `f${i}.pdf`, size: 10, createdAt: NOW })),
    });
    expect(screen.getByTestId("doc-upload")).toBeDisabled();
  });
});

// ── 3. SquadLink voice panel (moves to Kommunikation) ────────────────────────

describe("preserved — SquadLink voice panel", () => {
  function useSquadLink(state: Record<string, unknown>) {
    server.use(http.get(`${API}/operations/op_1/squadlink`, () => HttpResponse.json(state)));
  }
  const renderPanel = () => render(<SquadLinkPanel opId="op_1" />);

  it("renders nothing when voice is off for this operation", async () => {
    useSquadLink({ enabled: false, configured: true, started: true, link: "squadlink://connect?x=1", storeUrl: null });
    renderPanel();
    await waitFor(() => expect(screen.queryByTestId("squadlink-panel")).not.toBeInTheDocument());
  });

  it("says so when the server has no voice configuration, rather than offering a dead link", async () => {
    useSquadLink({ enabled: true, configured: false, started: true, link: null, storeUrl: null });
    renderPanel();
    expect(await screen.findByTestId("squadlink-panel")).toHaveTextContent("serverseitig noch nicht konfiguriert");
    expect(screen.queryByTestId("squadlink-join")).not.toBeInTheDocument();
  });

  it("holds the join link back until the operation has started", async () => {
    useSquadLink({ enabled: true, configured: true, started: false, link: null, storeUrl: null });
    renderPanel();
    expect(await screen.findByTestId("squadlink-panel")).toHaveTextContent("sobald die Operation gestartet ist");
    expect(screen.queryByTestId("squadlink-join")).not.toBeInTheDocument();
  });

  it("offers the deep link, the copy button and the store link once everything is ready", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    useSquadLink({
      enabled: true,
      configured: true,
      started: true,
      link: "squadlink://connect?room=op_1&t=abc",
      storeUrl: "https://apps.microsoft.com/detail/subraum",
    });
    renderPanel();

    expect(await screen.findByTestId("squadlink-join")).toHaveAttribute("href", "squadlink://connect?room=op_1&t=abc");
    expect(screen.getByTestId("squadlink-store")).toHaveAttribute("href", "https://apps.microsoft.com/detail/subraum");

    fireEvent.click(screen.getByTestId("squadlink-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("squadlink://connect?room=op_1&t=abc"));
  });
});

// ── 4. Formations and CQB bundling in the operator panel ─────────────────────

const emptyView: OperatorView = {
  crewRequests: [], questions: [], hangarShares: [], auditLogs: [], requirements: [],
  eventInterests: [], cqbTeams: [], cqbSoldiers: [], formations: [], fighterSquads: [],
  assignablePeople: [],
};

function renderPanelSection(section: "formations" | "cqb", view: OperatorView) {
  server.use(http.get(`${API}/operations/:id/operator`, () => HttpResponse.json(view)));
  const onChanged = vi.fn();
  const onError = vi.fn();
  render(
    <MemoryRouter>
      <FieldSaveProvider>
        <OperatorPanel
          op={{ ...opDetailFixture, canManage: true }}
          csrf="csrf-test-token"
          embedded
          section={section}
          onChanged={onChanged}
          onError={onError}
        />
      </FieldSaveProvider>
    </MemoryRouter>,
  );
  return { onChanged, onError };
}

describe("preserved — formations", () => {
  it("creates a formation from the name field", async () => {
    const created = vi.fn();
    server.use(
      http.post(`${API}/operations/op_1/formations`, async ({ request }) => {
        created(await request.json());
        return HttpResponse.json({ ok: true, id: "fm_1" });
      }),
    );
    renderPanelSection("formations", emptyView);

    fireEvent.change(await screen.findByTestId("formation-name"), { target: { value: "Task Force Alpha" } });
    fireEvent.click(screen.getByTestId("formation-add"));

    await waitFor(() => expect(created).toHaveBeenCalledWith({ name: "Task Force Alpha" }));
  });

  it("accepts Enter in the name field as the same action", async () => {
    const created = vi.fn();
    server.use(http.post(`${API}/operations/op_1/formations`, () => { created(); return HttpResponse.json({ ok: true, id: "fm_2" }); }));
    renderPanelSection("formations", emptyView);

    const input = await screen.findByTestId("formation-name");
    fireEvent.change(input, { target: { value: "Bravo" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(created).toHaveBeenCalled());
  });

  it("will not create a nameless formation", async () => {
    const created = vi.fn();
    server.use(http.post(`${API}/operations/op_1/formations`, () => { created(); return HttpResponse.json({ ok: true, id: "x" }); }));
    renderPanelSection("formations", emptyView);

    expect(await screen.findByTestId("formation-add")).toBeDisabled();
    expect(created).not.toHaveBeenCalled();
  });

  it("renames a formation when the inline field loses focus", async () => {
    const renamed = vi.fn();
    server.use(
      http.patch(`${API}/operations/op_1/formations/fm_7`, async ({ request }) => {
        renamed(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    renderPanelSection("formations", { ...emptyView, formations: [{ id: "fm_7", name: "Alpha" }] });

    const field = await screen.findByTestId("formation-name-fm_7");
    fireEvent.change(field, { target: { value: "Alpha Prime" } });
    fireEvent.blur(field);

    await waitFor(() => expect(renamed).toHaveBeenCalledWith({ name: "Alpha Prime" }));
  });

  it("deletes a formation", async () => {
    const deleted = vi.fn();
    server.use(http.delete(`${API}/operations/op_1/formations/fm_7`, () => { deleted(); return HttpResponse.json({ ok: true }); }));
    renderPanelSection("formations", { ...emptyView, formations: [{ id: "fm_7", name: "Alpha" }] });

    fireEvent.click(await screen.findByTestId("formation-del-fm_7"));
    await waitFor(() => expect(deleted).toHaveBeenCalled());
  });
});

describe("preserved — CQB bundling and fighter auto-fill", () => {
  const cqbView: OperatorView = {
    ...emptyView,
    cqbSoldiers: [
      { id: "sg_1", userId: "u1", username: "One", note: null, assignedGroupId: null, slotIndex: null, lateEta: null },
      { id: "sg_2", userId: "u2", username: "Two", note: null, assignedGroupId: null, slotIndex: null, lateEta: null },
    ],
  };

  it("bundles unassigned soldiers into squads of the chosen size", async () => {
    const bundled = vi.fn();
    server.use(
      http.post(`${API}/operations/op_1/cqb/auto-bundle`, async ({ request }) => {
        bundled(await request.json());
        return HttpResponse.json({ ok: true, created: 1 });
      }),
    );
    renderPanelSection("cqb", cqbView);

    // The size select is the parameter of the action, so it has to travel with it.
    fireEvent.change(await screen.findByTestId("cqb-bundle-size"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("cqb-auto-bundle"));

    await waitFor(() => expect(bundled).toHaveBeenCalledWith({ size: 5 }));
  });

  it("greys out bundling when every soldier already has a squad", async () => {
    renderPanelSection("cqb", {
      ...emptyView,
      cqbTeams: [{ id: "grp_1", name: "Squad 1", targetSize: 4, carrierUnitId: null, parentId: null }],
      cqbSoldiers: [{ id: "sg_1", userId: "u1", username: "One", note: null, assignedGroupId: "grp_1", slotIndex: 0, lateEta: null }],
    });
    expect(await screen.findByTestId("cqb-auto-bundle")).toBeDisabled();
  });

  it("fills the fighter squads in one action", async () => {
    const filled = vi.fn();
    server.use(http.post(`${API}/operations/op_1/fighter-squads/auto-fill`, () => { filled(); return HttpResponse.json({ ok: true, placed: 2 }); }));
    renderPanelSection("cqb", { ...emptyView, fighterSquads: [{ id: "fs_1", name: "Staffel 1", targetSize: 2, parentId: null }] });

    fireEvent.click(await screen.findByTestId("fighter-autofill"));
    await waitFor(() => expect(filled).toHaveBeenCalled());
  });
});

// ── 5. Participation state on the detail page (stays, but changes shape) ─────

describe("preserved — the viewer's own participation state", () => {
  it("tells a signed-up viewer that they are in, and offers the primary-unit choice for two units", async () => {
    const me = { id: "user_crew", username: "Crew One" };
    const twoUnits: OperationDetail = {
      ...opDetailFixture,
      units: [
        { ...opDetailFixture.units[0], id: "unit_1", name: "Perseus", shipName: "Perseus", captain: me },
        { ...opDetailFixture.units[0], id: "unit_2", name: "Cutlass", shipName: "Cutlass", captain: me, seats: [] },
      ],
      viewerPrimaryUnitId: null,
    };
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json(twoUnits)),
    );
    const chosen = vi.fn();
    server.use(
      http.put(`${API}/operations/op_1/primary-unit`, async ({ request }) => {
        chosen(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    renderAt("/ops/op_1");

    expect(await screen.findByTestId("my-status")).toHaveTextContent("BEREITS ANGEMELDET");
    fireEvent.change(await screen.findByTestId("primary-unit-select"), { target: { value: "unit_2" } });
    await waitFor(() => expect(chosen).toHaveBeenCalledWith({ unitId: "unit_2" }));
  });

  it("does not ask about a primary unit when the viewer only has one", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () =>
        HttpResponse.json({
          ...opDetailFixture,
          units: [{ ...opDetailFixture.units[0], captain: { id: "user_crew", username: "Crew One" } }],
        }),
      ),
    );
    renderAt("/ops/op_1");

    expect(await screen.findByTestId("my-status")).toBeInTheDocument();
    expect(screen.queryByTestId("primary-unit")).not.toBeInTheDocument();
  });

  it("marks an empty lane as having no requirement instead of leaving a blank column", async () => {
    server.use(
      http.get(`${API}/session`, () => HttpResponse.json(sessionCrew)),
      http.get(`${API}/operations/op_1`, () => HttpResponse.json({ ...opDetailFixture, units: [] })),
    );
    renderAt("/ops/op_1");

    const empties = await screen.findAllByText("KEIN BEDARF");
    expect(empties.length).toBeGreaterThan(0);
  });
});


// ── 6. Voice recipients and the needs editor (move as whole panels, phase 3) ──

describe("preserved — voice recipients", () => {
  const opWithCrew: OperationDetail = {
    ...opDetailFixture,
    canManage: true,
    leaders: [{ id: "user_lead", username: "Lead" }],
  };

  function renderVoice(enabled = true) {
    const onToggleVoice = vi.fn();
    const onNotice = vi.fn();
    render(
      <FieldSaveProvider>
        <VoicePanel op={opWithCrew} csrf="csrf-test-token" voiceEnabled={enabled} onToggleVoice={onToggleVoice} onNotice={onNotice} />
      </FieldSaveProvider>,
    );
    return { onToggleVoice, onNotice };
  }

  it("offers nothing to hand out while voice is switched off", () => {
    renderVoice(false);
    expect(screen.getByTestId("voice-master-toggle")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("voice-copy")).not.toBeInTheDocument();
    expect(screen.queryByTestId("voice-assign-all")).not.toBeInTheDocument();
  });

  it("copies the room link the server handed out, not the placeholder", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    server.use(
      http.get(`${API}/operations/op_1/squadlink`, () =>
        HttpResponse.json({ enabled: true, configured: true, started: true, link: "squadlink://connect?room=op_1", storeUrl: null }),
      ),
      http.get(`${API}/operations/op_1/voice/recipients`, () => HttpResponse.json({ userIds: [] })),
    );
    renderVoice();

    // The panel shows a masked placeholder until the real link arrives — copying
    // that would hand somebody a string that connects to nothing.
    await waitFor(() => expect(screen.getByText("squadlink://connect?room=op_1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("voice-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("squadlink://connect?room=op_1"));
  });

  it("grants one participant the link, and grants everyone at once", async () => {
    const put = vi.fn();
    server.use(
      http.get(`${API}/operations/op_1/squadlink`, () => HttpResponse.json({ enabled: true, configured: true, started: true, link: "squadlink://x", storeUrl: null })),
      http.get(`${API}/operations/op_1/voice/recipients`, () => HttpResponse.json({ userIds: [] })),
      http.put(`${API}/operations/op_1/voice/recipients`, async ({ request }) => {
        const body = (await request.json()) as { userIds: string[] };
        put(body.userIds);
        return HttpResponse.json({ ok: true, userIds: body.userIds });
      }),
    );
    renderVoice();

    // Candidates are the leaders plus everyone holding a seat.
    fireEvent.click(await screen.findByTestId("voice-toggle-user_lead"));
    await waitFor(() => expect(put).toHaveBeenCalledWith(["user_lead"]));

    fireEvent.click(screen.getByTestId("voice-assign-all"));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[1][0]).toContain("user_lead");
  });

  it("puts the grant list back when the server refuses it", async () => {
    server.use(
      http.get(`${API}/operations/op_1/squadlink`, () => HttpResponse.json({ enabled: true, configured: true, started: true, link: "squadlink://x", storeUrl: null })),
      http.get(`${API}/operations/op_1/voice/recipients`, () => HttpResponse.json({ userIds: [] })),
      http.put(`${API}/operations/op_1/voice/recipients`, () =>
        HttpResponse.json({ error: { code: "forbidden", message: "Nein.", requestId: "r" } }, { status: 403 }),
      ),
    );
    const { onNotice } = renderVoice();

    fireEvent.click(await screen.findByTestId("voice-toggle-user_lead"));
    await waitFor(() => expect(onNotice).toHaveBeenCalled());
    // Optimistic display rolled back — the button must not claim a grant that
    // never landed.
    await waitFor(() => expect(screen.getByTestId("voice-toggle-user_lead")).toHaveTextContent("Link senden"));
  });
});

describe("preserved — the needs editor", () => {
  const needsFixture = {
    shipTypes: [{ slug: "any", label: "Any ship" }, { slug: "capital", label: "Capital" }],
    cqbTeamMax: 8,
    cqbTeamDefault: 4,
    fighterSquadSize: 2,
    shipNeeds: [{ id: "req_1", label: "Tank", shipType: "capital" }],
    fighterSquads: 0,
    cqbTeams: { count: 0, size: 4 },
    requirements: [],
  };

  function renderNeeds(over: Partial<typeof needsFixture> = {}) {
    server.use(http.get(`${API}/operations/op_1/needs`, () => HttpResponse.json({ ...needsFixture, ...over })));
    render(<NeedsEditor opId="op_1" csrf="csrf-test-token" />);
  }

  it("saves the CQB team count and size together", async () => {
    const saved = vi.fn();
    server.use(
      http.put(`${API}/operations/op_1/needs/cqb`, async ({ request }) => {
        saved(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    renderNeeds();

    fireEvent.change(await screen.findByTestId("cqb-count"), { target: { value: "3" } });
    fireEvent.change(screen.getByTestId("cqb-size"), { target: { value: "6" } });
    fireEvent.click(screen.getByTestId("cqb-save"));

    // Size travels with the count — saving one without the other would silently
    // reset the other to whatever the form last showed.
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ count: 3, size: 6 }));
  });

  it("keeps Save inert until something actually changed", async () => {
    renderNeeds();
    expect(await screen.findByTestId("cqb-save")).toBeDisabled();
    expect(screen.getByTestId("fighters-save")).toBeDisabled();
  });

  it("says why a failed save failed instead of looking saved", async () => {
    server.use(
      http.put(`${API}/operations/op_1/needs/cqb`, () =>
        HttpResponse.json({ error: { code: "conflict", message: "Team ist besetzt.", requestId: "r" } }, { status: 409 }),
      ),
    );
    renderNeeds();

    fireEvent.change(await screen.findByTestId("cqb-count"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("cqb-save"));

    expect(await screen.findByTestId("needs-notice")).toHaveTextContent("Team ist besetzt.");
  });

  it("renames and removes a ship need", async () => {
    const renamed = vi.fn();
    const removed = vi.fn();
    server.use(
      http.patch(`${API}/operations/op_1/needs/req_1`, async ({ request }) => { renamed(await request.json()); return HttpResponse.json({ ok: true }); }),
      http.delete(`${API}/operations/op_1/needs/req_1`, () => { removed(); return HttpResponse.json({ ok: true }); }),
    );
    renderNeeds();

    const field = await screen.findByTestId("need-rename");
    fireEvent.change(field, { target: { value: "Schwerer Tank" } });
    fireEvent.blur(field);
    await waitFor(() => expect(renamed).toHaveBeenCalledWith({ name: "Schwerer Tank" }));

    fireEvent.click(screen.getByTestId("need-remove-req_1"));
    await waitFor(() => expect(removed).toHaveBeenCalled());
  });
});
