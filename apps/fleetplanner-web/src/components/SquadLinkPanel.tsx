import { useEffect, useState } from "react";
import { getSquadLink } from "../api/client";
import { Ic } from "./Icons";
import { CardHead, MONO, btnGhost, btnPrimary, card } from "./ui";

type State = {
  enabled: boolean;
  configured: boolean;
  started: boolean;
  link: string | null;
  storeUrl: string | null;
};

// Commander-facing SquadLink Lite voice panel. Shown to op commanders when the
// op has voice enabled. Fetches the caller's personalised `squadlink://connect`
// deep-link (CommandNet room) — only present once the op has started. The link
// joins SquadLink Lite without PIN/code; the store link installs the app.
export function SquadLinkPanel({ opId }: { opId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    getSquadLink(opId)
      .then((r) => live && setState(r))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, [opId]);

  // Feature off for this op, or fetch failed → render nothing.
  if (!state || !state.enabled) return null;

  async function copy() {
    if (!state?.link) return;
    try {
      await navigator.clipboard.writeText(state.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the anchor still works */
    }
  }

  return (
    <section style={card} data-testid="squadlink-panel">
      <CardHead icon="mic" label="SQUADLINK VOICE" tone="violet" />
      <p style={{ color: "var(--dim)", fontSize: "0.8rem", margin: "0 0 0.8rem" }}>
        Sprachverbindung der Operationscommandanten (CommandNet). Klick verbindet RDOC
        SquadLink Lite direkt — ohne Code oder PIN.
      </p>

      {!state.configured ? (
        <div style={{ color: "var(--gold)", fontSize: "0.78rem", fontFamily: MONO }}>
          Voice ist serverseitig noch nicht konfiguriert.
        </div>
      ) : !state.started ? (
        <div style={{ color: "var(--dim)", fontSize: "0.8rem", fontFamily: MONO }}>
          Der Beitritts-Link erscheint, sobald die Operation gestartet ist.
        </div>
      ) : state.link ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <a href={state.link} data-testid="squadlink-join" style={{ ...btnPrimary, textDecoration: "none" }}>
            <Ic name="mic" size={15} sw={1.8} /> Voice beitreten
          </a>
          <button type="button" data-testid="squadlink-copy" style={btnGhost} onClick={copy}>
            <Ic name={copied ? "check" : "link"} size={14} sw={1.7} /> {copied ? "Kopiert" : "Link kopieren"}
          </button>
        </div>
      ) : null}

      {state.storeUrl && (
        <div style={{ marginTop: "0.8rem", paddingTop: "0.8rem", borderTop: "1px solid var(--wash)" }}>
          <span style={{ display: "block", color: "var(--dim)", fontSize: "0.74rem", marginBottom: "0.4rem" }}>
            App noch nicht installiert?
          </span>
          <a
            href={state.storeUrl}
            target="_blank"
            rel="noreferrer"
            data-testid="squadlink-store"
            style={{ ...btnGhost, textDecoration: "none" }}
          >
            <Ic name="arrow" size={14} sw={1.7} /> SquadLink Lite installieren (Microsoft Store)
          </a>
        </div>
      )}
    </section>
  );
}
