import { useCallback, useState } from "react";
import { Icon } from "./kit/Icon";
import { startDownloadInBrowser, type RemoteVersion } from "../lib/updater";

type Props = {
  remote: RemoteVersion;
  /** Bridge URL + active session token — needed to mint the download URL. */
  bridgeUrl: string;
  sessionToken: string | null;
  /** User clicked "Später" — defer until next launch. */
  onPostpone: () => void;
};

export function UpdateModal({ remote, bridgeUrl, sessionToken, onPostpone }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDownload = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await startDownloadInBrowser({ bridgeUrl, sessionToken });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setOpened(true);
  }, [bridgeUrl, sessionToken]);

  const pubText = remote.publishedAt
    ? remote.publishedAt.replace("T", " ").slice(0, 16) + " UTC"
    : null;
  const sizeMB = remote.assetSize ? (remote.assetSize / 1048576).toFixed(1) : null;

  return (
    <div className="cc-modal-backdrop" onClick={busy ? undefined : onPostpone}>
      <div className="cc-modal cc-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="cc-modal-title">
          UPDATE VERFÜGBAR<span className="sep"> // </span><em>v{remote.version}</em>
        </div>

        <p style={{ fontSize: 13, lineHeight: 1.5 }}>
          Eine neue Version von <strong>RDOC Squad Link</strong> ist im Repo.
        </p>

        <div className="cc-readout" style={{ fontSize: 12 }}>
          <span className="lbl">Aktuell</span>
          <span className="val">{remote.tagName}</span>
        </div>
        {pubText ? (
          <div className="cc-hint" style={{ marginTop: -4 }}>
            Veröffentlicht: {pubText}{sizeMB ? ` · ${sizeMB} MB` : ""}
          </div>
        ) : null}

        {remote.notes ? (
          <div
            className="cc-card"
            style={{
              maxHeight: 200, overflow: "auto", fontSize: 12,
              lineHeight: 1.45, whiteSpace: "pre-wrap",
            }}
          >
            <span className="cc-card-tick"></span>
            <div className="cc-card-title"><span>RELEASE NOTES</span></div>
            {remote.notes}
          </div>
        ) : null}

        {opened ? (
          <div className="cc-banner info">
            <Icon.check size={12} />
            Browser geöffnet — folge der Anleitung dort. Companion schließen, EXE ersetzen, neu starten.
          </div>
        ) : null}

        {error ? (
          <div className="cc-banner error">
            <Icon.x size={12} />
            {error}
          </div>
        ) : null}

        <div className="cc-modal-actions">
          <button type="button" className="cc-btn ghost" onClick={onPostpone} disabled={busy}>
            SPÄTER
          </button>
          <button type="button" className="cc-btn green" onClick={onDownload} disabled={busy || opened}>
            {busy ? <Icon.loader size={12} className="cc-spin" /> : <Icon.copy size={12} />}
            {opened ? "BROWSER GEÖFFNET" : "DOWNLOAD IM BROWSER ÖFFNEN"}
          </button>
        </div>
      </div>
    </div>
  );
}
