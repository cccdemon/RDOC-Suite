import { useState } from "react";
import { ApiError, setProfileLocale, setProfileShareHangar } from "../api/client";
import type { SessionResponse } from "../api/types";
import { LOCALE_NAMES, LOCALES, useLocale, useT, type Locale } from "../i18n";
import { CardHead, card, lbl, segChip } from "./ui";

// FR-B8: user preferences. Language switch is functional (drives the SPA i18n) and
// persisted on the account. (Op-detail-style preference is intentionally omitted —
// the redesigned SPA has a single unified op-detail view, so the old
// classic/board1/board2 choice no longer has any effect.)
export function PreferencesPanel({ session }: { session: SessionResponse | null }) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const csrf = session?.csrfToken ?? null;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [share, setShare] = useState<boolean>(session?.user?.shareHangarWithOrg ?? false);

  async function toggleShare() {
    if (!csrf) return;
    const next = !share;
    setShare(next); // optimistic
    setBusy(true);
    try {
      await setProfileShareHangar(csrf, next);
      setNotice(t("prefs.saved"));
    } catch (e) {
      setShare(!next); // revert
      setNotice(e instanceof ApiError ? e.message : t("prefs.error"));
    } finally {
      setBusy(false);
    }
  }

  async function changeLanguage(l: Locale) {
    setLocale(l); // instant UI switch (optimistic)
    if (!csrf) return;
    setBusy(true);
    try {
      await setProfileLocale(csrf, l);
      setNotice(t("prefs.saved"));
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : t("prefs.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={card} data-testid="prefs-panel">
      <CardHead icon="globe" label={t("prefs.title").toUpperCase()} tone="cyan" />
      {notice && <p className="tag tag-green" role="status" style={{ marginBottom: "1rem" }}>{notice}</p>}
      <div style={lbl}>{t("prefs.language")}</div>
      <p style={{ margin: "0 0 0.7rem", color: "var(--dim)", fontSize: "0.85rem" }}>{t("prefs.languageHint")}</p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {LOCALES.map((l) => (
          <button key={l} type="button" data-testid={`prefs-lang-${l}`} disabled={busy} onClick={() => changeLanguage(l)} style={segChip(locale === l, "var(--cyan)")}>
            {LOCALE_NAMES[l]}
          </button>
        ))}
      </div>

      {/* FR-P3: Org-Flotte opt-in */}
      <div style={{ ...lbl, marginTop: "1.4rem" }}>ORG-FLOTTE</div>
      <p style={{ margin: "0 0 0.7rem", color: "var(--dim)", fontSize: "0.85rem" }}>
        Wenn aktiv, erscheinen deine Schiffe in der Org-Flotte deines Servers — andere Orgamember sehen,
        dass du sie hast (zum Ausleihen/Ansehen). Standardmäßig aus.
      </p>
      <button
        type="button"
        data-testid="prefs-share-hangar"
        disabled={busy}
        onClick={toggleShare}
        style={segChip(share, "var(--cyan)")}
      >
        {share ? "✓ Schiffe in Org-Flotte zeigen" : "Schiffe NICHT in Org-Flotte zeigen"}
      </button>
    </section>
  );
}
