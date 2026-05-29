import { buildConfig } from "./config";

export type SessionJoinResult =
  | { ok: true; sessionId: string; sessionLabel: string; livekitUrl: string; livekitToken: string }
  | { ok: false; reason: "invalid_token" | "already_used" | "network_error" | string };

export async function joinSession(
  bridgeUrl: string,
  bearerToken: string,
  inviteToken: string,
): Promise<SessionJoinResult> {
  const { bridgeHttpUrl } = buildConfig(bridgeUrl);
  try {
    const res = await fetch(`${bridgeHttpUrl}/sessions/join`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({ inviteToken }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        sessionId: string;
        sessionLabel: string;
        livekitUrl: string;
        livekitToken: string;
      };
      return { ok: true, ...data };
    }
    const err = await res.json().catch(() => ({})) as { error?: string };
    return { ok: false, reason: err.error ?? `http_${res.status}` };
  } catch {
    return { ok: false, reason: "network_error" };
  }
}
