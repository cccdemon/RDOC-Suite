import { useEffect, useState } from "react";
import { announceOperation, ApiError, getGuildChannels } from "../api/client";
import { Ic } from "./Icons";
import { MONO, inp, lbl } from "./ui";

// FR-C2: post a one-shot announcement (title, time, link) to a Discord channel.
//
// This used to be a local component inside the create wizard, reachable exactly
// once — right after creating the operation. Announcing a day later, or a second
// time after a change, meant there was no way to do it at all. It is a shared
// component now and also lives in Verwalten › Freigabe & Verteilung (§7.1).
export function AnnouncePanel({
  opId,
  guildId,
  csrf,
  onNotice,
}: {
  opId: string;
  guildId: string;
  csrf: string | null;
  onNotice: (m: string) => void;
}) {
  const [channels, setChannels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    getGuildChannels(guildId).then((r) => setChannels(r.channels)).catch(() => setChannels([]));
  }, [guildId]);

  async function post() {
    if (!csrf || !channel || busy) return;
    setBusy(true);
    try {
      await announceOperation(opId, csrf, channel);
      setPosted(true);
      onNotice("Ankündigung gepostet.");
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : "Posten fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (channels !== null && channels.length === 0) return null; // bot not configured / no channels

  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1.1rem 1.2rem" }} data-card="form" data-testid="share-channel">
      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.06em", color: "var(--text-hi)", marginBottom: "0.9rem" }}>
        <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="chat" size={15} sw={1.6} /></span> ANKÜNDIGUNG TEILEN
      </div>
      {channels === null ? (
        <p style={{ ...lbl, marginBottom: 0 }}>LADE KANÄLE…</p>
      ) : (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <select data-testid="share-channel-select" value={channel} onChange={(e) => setChannel(e.target.value)} style={{ ...inp, width: "auto", minWidth: 200, flex: "1 1 200px" }}>
            <option value="">Kanal wählen…</option>
            {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
          <button type="button" data-testid="share-channel-post" disabled={busy || !channel || !csrf} onClick={post} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.5rem 1rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.74rem", borderRadius: 9, cursor: "pointer" }}>
            {posted ? <><Ic name="check" size={14} sw={2} /> Gepostet</> : <><Ic name="chat" size={14} sw={1.7} /> In Kanal posten</>}
          </button>
        </div>
      )}
    </section>
  );
}
