import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { saveSession } from "./store";

/** Decode a JWT payload and return the `sub` claim (= Discord userId).
 *  We don't verify the signature — the bridge already does that on
 *  every WS connect, and we just want a quick local read so the UI
 *  can identify "this is me" (e.g., to skip the per-user volume slider
 *  for one's own row). Returns null for malformed input. */
export function jwtSubject(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const padded = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded + "==".slice((padded.length + 2) % 4));
    const payload = JSON.parse(json) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Opens Discord OAuth in a Tauri child WebviewWindow. The bridge's
 *  success page ends with a redirect to `dccc://auth?token=…&guildId=…`;
 *  the Rust side intercepts that navigation, extracts the params,
 *  emits "oauth-completed" and closes the OAuth window.
 *
 *  Resolves with the session credentials, or rejects if the user
 *  closed the OAuth window manually. No system browser involved,
 *  no `dccc://` OS scheme registration, no copy-paste fallback. */
export async function startOAuthInWebview(
  bridgeUrl: string,
  guildId: string,
): Promise<{ token: string; guildId: string }> {
  return await new Promise<{ token: string; guildId: string }>((resolve, reject) => {
    let settled = false;
    let unlistenCompleted: (() => void) | null = null;
    let unlistenCancelled: (() => void) | null = null;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      unlistenCompleted?.();
      unlistenCancelled?.();
      fn();
    };

    void (async () => {
      try {
        unlistenCompleted = await listen<{ token: string; guild_id: string }>(
          "oauth-completed",
          (e) => {
            settle(() => {
              const { token, guild_id: guildId2 } = e.payload;
              void saveSession(token, guildId2);
              resolve({ token, guildId: guildId2 });
            });
          },
        );
        unlistenCancelled = await listen<unknown>("oauth-cancelled", () => {
          settle(() => reject(new Error("OAuth abgebrochen")));
        });
        await invoke("start_oauth_webview", { bridgeUrl, guildId });
      } catch (err) {
        settle(() => reject(err));
      }
    })();
  });
}
