import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, listPolls } from "../api/client";
import type { PollSummary, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { useT } from "../i18n";

const MONO = "var(--mono)";

export function visibilityTag(v: PollSummary["visibility"]): { labelKey: string; color: string; bg: string; bd: string } {
  switch (v) {
    case "partners":
      return { labelKey: "poll.vis.partners", color: "var(--gold)", bg: "rgba(217, 169, 78,0.09)", bd: "rgba(217, 169, 78,0.42)" };
    case "public":
      return { labelKey: "poll.vis.public", color: "var(--purple)", bg: "rgba(118, 130, 141,0.09)", bd: "rgba(118, 130, 141,0.42)" };
    default:
      return { labelKey: "poll.vis.private", color: "var(--cyan)", bg: "rgba(43, 49, 53, 0.08)", bd: "rgba(43, 49, 53, 0.38)" };
  }
}

function Tag({ label, color, bg, bd }: { label: string; color: string; bg: string; bd: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.08em", padding: "0.16rem 0.45rem", borderRadius: 4, border: `1px solid ${bd}`, background: bg, color, textTransform: "uppercase", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function fmtCloses(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function PollsPage({ session }: { session: SessionResponse | null }) {
  const t = useT();
  const [polls, setPolls] = useState<PollSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");

  useEffect(() => {
    setLoading(true);
    listPolls()
      .then((r) => setPolls(r.polls))
      .catch((e) => setError(e instanceof ApiError ? e.message : t("polls.notLoadable")))
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(
    () => (filter === "all" ? polls : polls.filter((p) => p.status === filter)),
    [polls, filter],
  );
  const openCount = polls.filter((p) => p.status === "open").length;
  const closedCount = polls.filter((p) => p.status === "closed").length;

  const seg: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "0.42rem 0.8rem", fontFamily: MONO,
    fontSize: "0.7rem", borderRadius: 7, cursor: "pointer", border: "1px solid transparent", background: "transparent", color: "var(--dim)",
  };
  const segOn: React.CSSProperties = { background: "rgba(43, 49, 53, 0.14)", borderColor: "var(--border-hi)", color: "var(--cyan)" };

  return (
    <div data-testid="polls-page" style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "1.1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.25rem" }}>
            <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="check" size={20} /></span>
            <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "var(--text-hi)", margin: 0 }}>{t("polls.title")}</h1>
          </div>
          <div style={{ color: "var(--dim)", fontSize: "0.9rem" }}>
            {t("polls.count", { open: openCount, closed: closedCount })}
          </div>
        </div>
        {session?.user && (
          <Link
            data-testid="poll-new-link"
            to="/polls/new"
            className="fpw-btn"
            style={{ borderColor: "rgba(91, 185, 138,0.5)", background: "rgba(91, 185, 138,0.12)", color: "var(--green)" }}
          >
            <Ic name="plus" size={14} /> {t("polls.new")}
          </Link>
        )}
      </div>

      <div style={{ display: "inline-flex", gap: 6, background: "var(--bg2)", border: "1px solid rgba(255,255,255,0.08)", padding: 4, borderRadius: 10, marginBottom: "1.1rem" }}>
        {(["all", "open", "closed"] as const).map((f) => (
          <span key={f} data-testid={`poll-filter-${f}`} style={filter === f ? { ...seg, ...segOn } : seg} onClick={() => setFilter(f)}>
            {t(`polls.filter.${f}`)}
          </span>
        ))}
      </div>

      {loading ? (
        <p className="fpw-meta">{t("common.loading")}</p>
      ) : error ? (
        <p className="fpw-meta" style={{ color: "var(--red)" }}>{error}</p>
      ) : shown.length === 0 ? (
        <p className="fpw-meta">{t("polls.empty")} {session?.user ? t("polls.emptyHint") : t("polls.emptyAnon")}</p>
      ) : (
        <div className="fpw-grid">
          {shown.map((p) => {
            const vt = visibilityTag(p.visibility);
            const closes = fmtCloses(p.closesAt);
            return (
              <Link key={p.id} data-testid={`poll-card-${p.id}`} to={`/polls/${p.id}`} className="fpw-card fpw-cardlink" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                  {p.status === "open" ? (
                    <Tag label={t("poll.status.open")} color="var(--green)" bg="rgba(91, 185, 138,0.08)" bd="rgba(91, 185, 138,0.4)" />
                  ) : p.status === "draft" ? (
                    <Tag label={t("poll.status.draft")} color="var(--gold)" bg="rgba(217, 169, 78,0.09)" bd="rgba(217, 169, 78,0.42)" />
                  ) : (
                    <Tag label={t("poll.status.closed")} color="var(--dim)" bg="rgba(118, 130, 141,0.07)" bd="rgba(118, 130, 141,0.34)" />
                  )}
                  <Tag label={t(vt.labelKey)} color={vt.color} bg={vt.bg} bd={vt.bd} />
                  <Tag label={p.mode === "multiple" ? t("poll.mode.multi") + (p.maxChoices ? t("poll.maxChoices", { n: p.maxChoices }) : "") : t("poll.mode.single")} color="var(--dim)" bg="rgba(118, 130, 141,0.07)" bd="rgba(118, 130, 141,0.34)" />
                </div>
                <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--text-hi)", lineHeight: 1.2 }}>{p.title}</div>
                {p.description && (
                  <div style={{ color: "var(--dim)", fontSize: "0.9rem", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.description}</div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: "0.3rem 1rem", flexWrap: "wrap", fontFamily: MONO, fontSize: "0.66rem", color: "var(--dim2)", letterSpacing: "0.04em", marginTop: "auto" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Ic name="users" size={12} /> {t("poll.votes", { n: p.totalVotes })}</span>
                  {closes && <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Ic name="clock" size={12} /> {p.status === "closed" ? t("poll.ended") : t("poll.until", { when: closes })}</span>}
                  {p.viewerHasVoted && <span style={{ color: "var(--green)" }}>{t("poll.youVoted")}</span>}
                  <span>{t("poll.by", { who: p.createdBy.username })}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
