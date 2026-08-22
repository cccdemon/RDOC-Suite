import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { WizardPage } from "../pages/WizardPage";
import { server } from "./setup";
import { sessionCrew } from "./fixtures";
import type { SessionResponse } from "../api/types";

// Op-creation wizard, per UI audit §10 + the acceptance list in §14: a required
// step cannot be skipped unnoticed, the summary is a way back, creating produces
// exactly one draft, and opening vs. post-processing are two named ways out.
const API = "/fleetplanner/api/v1";

const sessionOperator: SessionResponse = {
  ...sessionCrew,
  memberships: [{ guildId: "guild_1", guildName: "RDOC", role: "fleetoperator" }],
};

function renderWizard() {
  return render(
    <MemoryRouter>
      <WizardPage session={sessionOperator} />
    </MemoryRouter>,
  );
}

function fillCore() {
  fireEvent.change(screen.getByTestId("wiz-title"), { target: { value: "Operation Darkstar" } });
  fireEvent.change(screen.getByTestId("wiz-when"), { target: { value: "2026-12-01T20:00" } });
}

const stepHeading = () => screen.getByText(/^SCHRITT \d \/ 6/).textContent ?? "";

beforeEach(() => {
  window.localStorage.clear();
  server.use(http.get(`${API}/guilds/:id/partnerships`, () => HttpResponse.json({ partnerships: [] })));
});

// ── validation ───────────────────────────────────────────────────────────────
describe("wizard — step validation", () => {
  it("blocks Weiter while a required field is empty and focuses it", async () => {
    renderWizard();
    await screen.findByTestId("create-page");

    fireEvent.click(screen.getByTestId("wiz-next"));

    expect(stepHeading()).toMatch(/SCHRITT 1 \/ 6/);
    expect(screen.getByTestId("wiz-err-title")).toBeInTheDocument();
    expect(screen.getByTestId("wiz-err-when")).toBeInTheDocument();
    expect(screen.getByTestId("wiz-title")).toHaveFocus();
    expect(screen.getByTestId("create-notice")).toHaveTextContent(/Pflichtfeld/);
  });

  it("lets Weiter through once the step is valid and clears the error", async () => {
    renderWizard();
    await screen.findByTestId("create-page");

    fireEvent.click(screen.getByTestId("wiz-next"));
    expect(screen.getByTestId("wiz-err-title")).toBeInTheDocument();

    fillCore();
    expect(screen.queryByTestId("wiz-err-title")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wiz-next"));
    expect(stepHeading()).toMatch(/SCHRITT 2 \/ 6/);
  });

  it("refuses a rail jump past an incomplete required step", async () => {
    renderWizard();
    await screen.findByTestId("create-page");

    expect(screen.getByTestId("wiz-step-3")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("wiz-step-3"));
    expect(stepHeading()).toMatch(/SCHRITT 1 \/ 6/);
    expect(screen.getByTestId("create-notice")).toHaveTextContent(/Eckdaten/);

    fillCore();
    expect(screen.getByTestId("wiz-step-3")).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByTestId("wiz-step-3"));
    expect(stepHeading()).toMatch(/SCHRITT 4 \/ 6/);
  });
});

// ── ways back ────────────────────────────────────────────────────────────────
describe("wizard — the summary is a way back", () => {
  it("a review row jumps to the step that owns it", async () => {
    renderWizard();
    await screen.findByTestId("create-page");
    fillCore();

    fireEvent.click(screen.getByTestId("wiz-step-4"));
    expect(stepHeading()).toMatch(/SCHRITT 5 \/ 6/);

    const briefingRow = screen.getAllByTestId(/^wiz-review-/).find((el) => el.getAttribute("data-step") === "1");
    expect(briefingRow).toBeDefined();
    fireEvent.click(briefingRow!);
    expect(stepHeading()).toMatch(/SCHRITT 2 \/ 6/);
  });

  it("the sidebar summary jumps to its step", async () => {
    renderWizard();
    await screen.findByTestId("create-page");
    fillCore();

    fireEvent.click(screen.getByTestId("wiz-summary-2"));
    expect(stepHeading()).toMatch(/SCHRITT 3 \/ 6/);
  });
});

// ── draft protection ─────────────────────────────────────────────────────────
describe("wizard — draft survives leaving the page", () => {
  it("stores the draft, restores it on the next visit and can discard it", async () => {
    const first = renderWizard();
    await screen.findByTestId("create-page");
    fillCore();

    await waitFor(() => expect(window.localStorage.getItem("fpw.wizard.draft.v1")).toContain("Operation Darkstar"));
    first.unmount();

    renderWizard();
    await screen.findByTestId("create-page");
    expect(screen.getByTestId("wiz-draft-restored")).toBeInTheDocument();
    expect(screen.getByTestId("wiz-title")).toHaveValue("Operation Darkstar");

    fireEvent.click(screen.getByTestId("wiz-draft-discard"));
    expect(screen.getByTestId("wiz-title")).toHaveValue("");
    expect(window.localStorage.getItem("fpw.wizard.draft.v1")).toBeNull();
  });

  it("shows no restore banner without a draft", async () => {
    renderWizard();
    await screen.findByTestId("create-page");
    expect(screen.queryByTestId("wiz-draft-restored")).not.toBeInTheDocument();
  });
});

// ── create + post-create ─────────────────────────────────────────────────────
describe("wizard — creating", () => {
  it("creates exactly one op and then offers two named ways on", async () => {
    let creates = 0;
    server.use(
      http.post(`${API}/operations`, async () => {
        creates += 1;
        return HttpResponse.json({ ok: true, id: "op_new" });
      }),
      http.get(`${API}/operations/op_new/cover`, () => HttpResponse.json({ serviceConfigured: false, cover: null })),
    );

    renderWizard();
    await screen.findByTestId("create-page");
    fillCore();
    fireEvent.click(screen.getByTestId("wiz-step-5"));
    fireEvent.click(screen.getByTestId("wiz-create"));

    await screen.findByTestId("wiz-post-decision");
    expect(creates).toBe(1);
    expect(screen.getByTestId("wiz-to-op")).toBeInTheDocument();
    expect(screen.getByTestId("wiz-post-edit")).toBeInTheDocument();
    // Post-processing is a choice, not the default page.
    expect(screen.queryByTestId("wiz-post-panels")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("wiz-post-edit"));
    expect(await screen.findByTestId("wiz-post-panels")).toBeInTheDocument();
    // A created op is no longer an unsent draft.
    expect(window.localStorage.getItem("fpw.wizard.draft.v1")).toBeNull();
  });

  it("cannot be created from an incomplete step 0", async () => {
    let creates = 0;
    server.use(http.post(`${API}/operations`, () => { creates += 1; return HttpResponse.json({ ok: true, id: "op_new" }); }));

    renderWizard();
    await screen.findByTestId("create-page");
    // Step 5 is unreachable while the required step is empty; the rail sends the
    // operator back with the reason instead of creating a half-filled op.
    fireEvent.click(screen.getByTestId("wiz-step-5"));
    expect(stepHeading()).toMatch(/SCHRITT 1 \/ 6/);
    expect(screen.queryByTestId("wiz-create")).not.toBeInTheDocument();
    expect(creates).toBe(0);
  });
});

// ── the template picker is a dialog (§10) ────────────────────────────────────
describe("wizard — template picker", () => {
  it("traps focus, closes on Escape and hands focus back", async () => {
    server.use(http.get(`${API}/templates`, () => HttpResponse.json({ templates: [] })));
    renderWizard();
    await screen.findByTestId("create-page");

    const opener = screen.getByTestId("templates-link");
    expect(opener).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(opener);

    const dialog = await screen.findByTestId("template-picker");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "template-picker-title");
    // focus moved into the dialog
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("template-picker")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("templates-link")).toHaveFocus());
  });
});
