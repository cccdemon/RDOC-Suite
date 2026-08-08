import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  acceptPartnerToken,
  decideSharedEvent,
  getPartnerships,
  mintPartnerInvite,
  revokePartnership,
  setPartnerAutoShare,
} from "../api/client";
import type { IncomingDistribution, Partnership, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";

const MONO = "var(--mono)";
const label: React.CSSProperties = { fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "var(--dim)", marginBottom: "0.7rem" };
const field: React.CSSProperties = {
  boxSizing: "border-box", background: "var(--bg3)", border: "1px solid var(--border)",
  color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.95rem", padding: "0.55rem 0.7rem", borderRadius: 8, outline: "none",
};

export function PartnershipsPage({ session }: { session: SessionResponse | null }) {
  const me = session?.user ?? null;
  const csrf = session?.csrfToken ?? null;
  const manageable = (session?.memberships ?? []).filter((m) => m.role === "fleetoperator");

  const [guildId, setGuildId] = useState<string | null>(null);
  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [incoming, setIncoming] = useState<IncomingDistribution[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [inviteLabel, setInviteLabel] = useState("");
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [acceptToken, setAcceptToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  async function copyToken() {
    if (!mintedToken) return;
    try {
      await navigator.clipboard.writeText(mintedToken);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 1500);
    } catch {
      /* clipboard blocked — token still selectable in the code block */
    }
  }

  useEffect(() => {
    if (guildId === null && manageable.length > 0) setGuildId(manageable[0].guildId);
  }, [manageable, guildId]);

  function reload(id: string) {
    getPartnerships(id)
      .then((r) => {
        setPartnerships(r.partnerships);
        setIncoming(r.incoming);
        setLoaded(true);
      })
      .catch((e) => setNotice(e instanceof ApiError ? e.message : "Partnerschaften nicht ladbar."));
  }
  useEffect(() => {
    if (guildId) reload(guildId);
  }, [guildId]);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    if (!csrf || !guildId) return;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      after?.();
      reload(guildId);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function mint() {
    if (!csrf || !guildId) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await mintPartnerInvite(guildId, csrf, inviteLabel.trim());
      setMintedToken(r.token);
      setInviteLabel("");
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Token-Erstellung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (session === null) return <div className="fpw-state"><span style={label}>LADE…</span></div>;
  if (!me)
    return (
      <div className="fpw-state" data-testid="partnerships-anon">
        <span style={label}>ANMELDUNG ERFORDERLICH</span>
        <Link className="fpw-btn" to="/login">Anmelden</Link>
      </div>
    );
  if (manageable.length === 0)
    return (
      <div className="fpw-state" data-testid="partnerships-none">
        <span style={label}>KEINE SERVER-RECHTE</span>
        <p className="fpw-meta">Partnerschaften verwaltet ein Flottenoperator.</p>
      </div>
    );

  return (
    <div data-testid="partnerships-page" style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.3rem" }}>
        <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="users" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "var(--text-hi)", margin: 0 }}>Partnerschaften</h1>
      </div>
      <p className="fpw-meta" style={{ marginBottom: "1.4rem" }}>
        <Link to="/guilds/settings">← Server-Einstellungen</Link>
      </p>

      {manageable.length > 1 && (
        <section className="fpw-card" style={{ marginBottom: "1.2rem" }}>
          <div style={label}>SERVER</div>
          <select data-testid="partner-guild-select" value={guildId ?? ""} onChange={(e) => setGuildId(e.target.value)} style={{ ...field, width: "100%" }}>
            {manageable.map((m) => <option key={m.guildId} value={m.guildId}>{m.guildName}</option>)}
          </select>
        </section>
      )}

      {notice && <p className="fpw-tag gold" role="alert" data-testid="partner-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      {/* Incoming inbox */}
      {incoming.length > 0 && (
        <section className="fpw-card" style={{ marginBottom: "1.2rem", border: "1px solid var(--edge-gold)" }}>
          <div style={{ ...label, color: "var(--gold)" }}>EINGEHENDE EVENTS ({incoming.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {incoming.map((d) => (
              <div key={d.id} className="fpw-seat" data-testid={`incoming-${d.id}`}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", color: "var(--text-hi)" }}>{d.opTitle}</span>
                  <span className="fpw-meta">{d.hostOrgName || d.hostGuildName}</span>
                </span>
                <button type="button" data-testid={`incoming-approve-${d.id}`} className="fpw-btn" disabled={busy || !csrf} onClick={() => run(() => decideSharedEvent(guildId!, d.id, "approve", csrf!))} style={{ padding: "0.3rem 0.6rem", fontSize: "0.68rem" }}>Annehmen</button>
                <button type="button" data-testid={`incoming-decline-${d.id}`} disabled={busy || !csrf} onClick={() => run(() => decideSharedEvent(guildId!, d.id, "decline", csrf!))} style={{ padding: "0.3rem 0.6rem", fontSize: "0.68rem", borderRadius: 7, border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", cursor: "pointer", fontFamily: MONO }}>Ablehnen</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Partner list */}
      <section className="fpw-card" style={{ marginBottom: "1.2rem" }}>
        <div style={label}>PARTNER</div>
        {!loaded ? (
          <p className="fpw-meta">Lade…</p>
        ) : partnerships.length === 0 ? (
          <p className="fpw-meta">Noch keine Partnerschaften.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {partnerships.map((p) => (
              <div key={p.id} className="fpw-seat" data-testid={`partner-${p.id}`}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", color: "var(--text-hi)" }}>{p.partnerGuildName || p.label}</span>
                  <span className="fpw-meta">{p.label} · {p.status}{p.isInitiator ? " · ausgestellt" : ""}</span>
                </span>
                {p.status === "active" && p.partnerGuildId && (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "var(--dim)", fontSize: "0.8rem" }}>
                    <input type="checkbox" data-testid={`partner-autoshare-${p.id}`} checked={p.autoShare} disabled={busy || !csrf} onChange={(e) => run(() => setPartnerAutoShare(guildId!, p.partnerGuildId!, csrf!, e.target.checked))} style={{ accentColor: "var(--cyan)", width: 16, height: 16 }} />
                    Auto-Share
                  </label>
                )}
                <button type="button" data-testid={`partner-revoke-${p.id}`} title="Partnerschaft widerrufen" disabled={busy || !csrf} onClick={() => run(() => revokePartnership(guildId!, p.id, csrf!))} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <Ic name="x" size={12} sw={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Mint invite */}
      <section className="fpw-card" style={{ marginBottom: "1.2rem" }}>
        <div style={label}>PARTNER EINLADEN</div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input data-testid="invite-label" type="text" maxLength={80} value={inviteLabel} placeholder="Label (z. B. Allianz XYZ)" onChange={(e) => setInviteLabel(e.target.value)} style={{ ...field, flex: "1 1 200px" }} />
          <button type="button" data-testid="invite-mint" className="fpw-btn" disabled={busy || !csrf || inviteLabel.trim().length === 0} onClick={mint}>Token erstellen</button>
        </div>
        {mintedToken && (
          <div data-testid="minted-token" style={{ marginTop: "0.8rem" }}>
            <p className="fpw-meta" style={{ margin: "0 0 0.3rem", fontSize: "0.8rem" }}>Einmal-Token — jetzt kopieren, wird nicht erneut angezeigt:</p>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch", flexWrap: "wrap" }}>
              <code style={{ flex: "1 1 200px", wordBreak: "break-all", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem 0.7rem", color: "var(--cyan)", fontSize: "0.85rem" }}>{mintedToken}</code>
              <button type="button" data-testid="invite-copy" onClick={copyToken} aria-label="Token kopieren" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.45rem 0.8rem", border: `1px solid ${tokenCopied ? "var(--green)66" : "var(--border)"}`, background: tokenCopied ? "var(--tint-green)" : "var(--wash)", color: tokenCopied ? "var(--green)" : "var(--cyan)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
                <Ic name={tokenCopied ? "check" : "copy"} size={13} sw={1.8} /> {tokenCopied ? "Kopiert" : "Kopieren"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Accept invite */}
      <section className="fpw-card">
        <div style={label}>EINLADUNG EINLÖSEN</div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input data-testid="accept-token" type="text" maxLength={200} value={acceptToken} placeholder="Partner-Token einfügen" onChange={(e) => setAcceptToken(e.target.value)} style={{ ...field, flex: "1 1 240px" }} />
          <button type="button" data-testid="accept-submit" className="fpw-btn" disabled={busy || !csrf || acceptToken.trim().length === 0} onClick={() => run(() => acceptPartnerToken(guildId!, csrf!, acceptToken.trim()), () => setAcceptToken(""))}>Partner werden</button>
        </div>
      </section>
    </div>
  );
}
