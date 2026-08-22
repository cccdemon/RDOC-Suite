import { useEffect, useState } from "react";
import { getPartnerships } from "../api/client";
import type { OperationDetail } from "../api/types";
import { AnnouncePanel } from "./AnnouncePanel";
import { Ic } from "./Icons";
import { CardHead, MONO, card } from "./ui";
import { OP_STATUSES, statusMeta } from "./opStatus";

// Handoff §7.1 — "Freigabe & Verteilung".
//
// Three questions an operator has before an operation goes out, none of which
// had an answer anywhere: what does my current status actually mean for the
// people waiting, does anyone outside this server see this, and how do I tell
// Discord about it a second time. The last one existed exactly once, in the
// create wizard, and was unreachable a minute later.
//
// The status *switch* deliberately stays in the console header, where it is one
// click from every tab. §7.1 allows that and asks for the explanation to live
// here — so this is the explanation, not a second copy of the control.

const STATUS_MEANING: Record<string, string> = {
  draft: "Nur die Einsatzleitung sieht die Operation. Niemand kann sich anmelden, und Discord weiß nichts davon.",
  open: "Die Operation ist sichtbar und Anmeldungen sind offen — das ist der Zustand, in dem sich Crew einträgt.",
  locked: "Sichtbar, aber niemand kann sich noch anmelden oder einen Sitz nehmen. Die Aufstellung steht.",
  starting: "Die Operation beginnt gleich. Sichtbar wie „Offen“; gedacht als Signal an die Teilnehmer.",
  in_progress: "Die Operation läuft. Die Aufstellung bleibt einsehbar.",
  completed: "Abgeschlossen. Die Operation bleibt als Nachweis erhalten und taucht in der Übersicht unter „Vergangene“ auf.",
  cancelled: "Abgesagt. Das Discord-Event wird entfernt; die Operation selbst bleibt bestehen.",
};

/** Which visibilities let an operation leave the host server. */
function reachesPartners(visibility: string): boolean {
  return visibility === "partners" || visibility === "public";
}

export function ReleasePanel({ op, opId, csrf, onNotice }: { op: OperationDetail; opId: string; csrf: string | null; onNotice: (m: string) => void }) {
  const [partners, setPartners] = useState<Array<{ guildId: string; name: string }> | null>(null);
  const status = statusMeta(op.status);

  useEffect(() => {
    getPartnerships(op.guild.id)
      .then((r) =>
        setPartners(
          r.partnerships
            .filter((p) => p.status === "active" && p.partnerGuildId)
            .map((p) => ({ guildId: p.partnerGuildId as string, name: p.partnerGuildName ?? (p.partnerGuildId as string) })),
        ),
      )
      .catch(() => setPartners([]));
  }, [op.guild.id]);

  const partnerReach = reachesPartners(op.visibility);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <section style={card} data-testid="release-status">
        <CardHead icon="bolt" label="STATUS UND SEINE FOLGEN" tone="cyan" />
        <p style={{ margin: "0 0 0.9rem", display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
          <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.1em", color: "var(--dim2)" }}>AKTUELL</span>
          <span
            data-testid="release-current-status"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.06em", textTransform: "uppercase", color: status.color, border: `1px solid ${status.color}`, borderRadius: 8, padding: "0.24rem 0.6rem" }}
          >
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: status.color }} />
            {status.label}
          </span>
        </p>
        <p style={{ margin: "0 0 1rem", color: "var(--text)", fontSize: "0.9rem", lineHeight: 1.55 }} data-testid="release-status-meaning">
          {STATUS_MEANING[op.status] ?? "Für diesen Status ist keine Erklärung hinterlegt."}
        </p>
        <div style={{ borderTop: "1px solid var(--wash)", paddingTop: "0.9rem", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
          {OP_STATUSES.filter((s) => s.value !== op.status).map((s) => (
            <div key={s.value} style={{ display: "flex", gap: "0.7rem", alignItems: "baseline" }}>
              <span style={{ flex: "0 0 8.5rem", fontFamily: MONO, fontSize: "0.64rem", letterSpacing: "0.06em", textTransform: "uppercase", color: s.color }}>{s.label}</span>
              <span style={{ flex: 1, minWidth: 0, color: "var(--dim)", fontSize: "0.84rem", lineHeight: 1.5 }}>{STATUS_MEANING[s.value]}</span>
            </div>
          ))}
        </div>
        <p style={{ margin: "0.9rem 0 0", color: "var(--dim2)", fontSize: "0.8rem" }}>
          Umgeschaltet wird oben im Kopf der Konsole — dort ist der Schalter aus jedem Tab erreichbar.
        </p>
      </section>

      <AnnouncePanel opId={opId} guildId={op.guild.id} csrf={csrf} onNotice={onNotice} />

      <section style={card} data-testid="release-partners">
        <CardHead icon="link" label="PARTNER-VERTEILUNG" tone="cyan" />
        {!partnerReach ? (
          <p style={{ margin: 0, color: "var(--dim)", fontSize: "0.86rem", lineHeight: 1.55 }}>
            Die Sichtbarkeit steht auf <strong style={{ color: "var(--text)" }}>{op.visibility === "public" ? "Öffentlich" : "Privat"}</strong> —
            diese Operation verlässt {op.guild.name} nicht. Sichtbarkeit ändern: unter „Eckdaten“.
          </p>
        ) : partners === null ? (
          <p style={{ margin: 0, color: "var(--dim2)", fontFamily: MONO, fontSize: "0.78rem" }}>Lade Partner…</p>
        ) : partners.length === 0 ? (
          <p style={{ margin: 0, color: "var(--dim)", fontSize: "0.86rem", lineHeight: 1.55 }}>
            {op.guild.name} hat keine aktiven Partnerschaften. Die Operation bleibt damit auf diesem Server,
            obwohl die Sichtbarkeit Partner zulässt.
          </p>
        ) : (
          <>
            <p style={{ margin: "0 0 0.7rem", color: "var(--dim)", fontSize: "0.86rem", lineHeight: 1.55 }}>
              Aktive Partnerschaften von {op.guild.name}. Welche davon diese Operation bekommen, wird
              <strong style={{ color: "var(--text)" }}> beim Anlegen</strong> gewählt und lässt sich nachträglich
              nicht umstellen — ein Partner, der fehlt, braucht eine neue Operation.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {partners.map((p) => (
                <span
                  key={p.guildId}
                  data-testid={`release-partner-${p.guildId}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.3rem 0.6rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--wash)", color: "var(--dim)", fontSize: "0.82rem" }}
                >
                  <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="server" size={13} sw={1.6} /></span>
                  {p.name}
                </span>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
