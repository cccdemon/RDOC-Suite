import { openUrl } from "@tauri-apps/plugin-opener";
import { info, warn } from "@tauri-apps/plugin-log";
import { APP_BUILD, APP_VERSION } from "./version";
import { buildConfig } from "./config";

/** Compose the version string we compare against the remote tag.
 *  GitHub release tags follow the convention `v0.5.0-build{N}`; the
 *  Cargo/package.json version is just `0.5.0`. Without the build
 *  suffix every existing release would look "newer" to the installed
 *  EXE forever. */
const LOCAL_VERSION = `${APP_VERSION}-build${APP_BUILD}`;

/**
 * Notify-only auto-update flow.
 *
 *   1. Companion calls the bridge with its existing OAuth-JWT, gets
 *      back the latest GitHub-release version + notes (no download
 *      URL yet — that would be a public bypass of the admin's
 *      single-use-token mechanism).
 *   2. If the remote version is newer than what's baked into THIS
 *      build, the UI shows a modal popup with the release notes.
 *   3. User clicks "Download im Browser öffnen" → companion POSTs
 *      the JWT back, bridge mints a fresh single-use download token
 *      (labelled "[auto-update] <userId>"), returns the URL. The
 *      url gets opened in the system browser → regular landing
 *      page + SmartScreen-Anleitung + the user replaces the EXE
 *      manually.
 *
 * Keeps the EXE portable, keeps the admin-token audit trail intact,
 * keeps the SmartScreen-Hinweise reusable.
 */

export type RemoteVersion = {
  version: string;
  tagName: string;
  publishedAt: string | null;
  notes: string | null;
  assetName: string;
  assetSize: number;
};

export type UpdateCheckResult =
  | { kind: "no_update" }
  | { kind: "available"; remote: RemoteVersion }
  | { kind: "error"; message: string };

export async function checkForUpdate(opts: {
  bridgeUrl: string;
  sessionToken: string | null;
}): Promise<UpdateCheckResult> {
  if (!opts.bridgeUrl || !opts.sessionToken) {
    return { kind: "no_update" };
  }
  try {
    const { bridgeHttpUrl } = buildConfig(opts.bridgeUrl);
    const res = await fetch(
      `${bridgeHttpUrl}/updater/companion/check`,
      { cache: "no-store", headers: { authorization: `Bearer ${opts.sessionToken}` } },
    );
    if (res.status === 401) {
      void warn("[updater] check rejected — session token invalid/expired");
      return { kind: "no_update" };
    }
    if (!res.ok) {
      void warn(`[updater] check returned HTTP ${res.status}`);
      return { kind: "error", message: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as Partial<RemoteVersion>;
    if (!data.version) {
      return { kind: "error", message: "manifest missing version" };
    }
    if (!isNewer(data.version, LOCAL_VERSION)) {
      void info(`[updater] no update — installed ${LOCAL_VERSION} >= remote ${data.version}`);
      return { kind: "no_update" };
    }
    void info(`[updater] update available — installed ${LOCAL_VERSION} < remote ${data.version}`);
    return {
      kind: "available",
      remote: {
        version: data.version,
        tagName: data.tagName ?? `v${data.version}`,
        publishedAt: data.publishedAt ?? null,
        notes: data.notes ?? null,
        assetName: data.assetName ?? "rdoc-squad-link.exe",
        assetSize: data.assetSize ?? 0,
      },
    };
  } catch (err) {
    void warn(`[updater] check threw: ${String(err)}`);
    return { kind: "error", message: String(err) };
  }
}

/** Ask the bridge for a single-use download URL + open it in the
 *  system browser. */
export async function startDownloadInBrowser(opts: {
  bridgeUrl: string;
  sessionToken: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { bridgeHttpUrl } = buildConfig(opts.bridgeUrl);
    const res = await fetch(`${bridgeHttpUrl}/updater/companion/mint-download-token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.sessionToken}`,
      },
      body: "{}",
    });
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { url?: string };
    if (!data.url) return { ok: false, message: "missing url in response" };
    await openUrl(data.url);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/** Compare semver-ish strings. Returns true when `remote` > `local`. */
export function isNewer(remote: string, local: string): boolean {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .split(/[-+.]/)
    .map((p) => {
      // Match digits ANYWHERE in the segment so "build92" → 92.
      // Previous "^(\\d+)" required leading digits and treated every
      // "buildN" suffix as 0, making 91 vs 92 always equal.
      const m = /(\d+)/.exec(p);
      return m ? Number(m[1]) : 0;
    });
}
