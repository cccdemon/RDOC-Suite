import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Opens the Fleetplanner Discord OAuth flow in an embedded WebviewWindow.
 *  The fleetplanner redirects to dccc://fleet-auth?token=<bearer> on success;
 *  the Rust on_navigation handler catches it, emits "fleet-oauth-completed",
 *  and closes the window. Rejects if the user closes the window manually. */
export async function startFleetOAuthInWebview(
  fleetplannerUrl: string,
): Promise<{ token: string }> {
  return new Promise<{ token: string }>((resolve, reject) => {
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
        unlistenCompleted = await listen<{ token: string }>("fleet-oauth-completed", (e) => {
          settle(() => resolve({ token: e.payload.token }));
        });
        unlistenCancelled = await listen<unknown>("fleet-oauth-cancelled", () => {
          settle(() => reject(new Error("Fleet OAuth abgebrochen")));
        });
        await invoke("start_fleet_oauth_webview", { fleetplannerUrl });
      } catch (err) {
        settle(() => reject(err));
      }
    })();
  });
}
