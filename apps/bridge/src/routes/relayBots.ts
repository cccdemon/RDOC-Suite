import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { requireAdminSession } from "../admin/middleware.js";
import {
  getRelayBotsConfig,
  setRelayBotsConfig,
  notifyRelayBotsReload,
} from "../services/relayBotsConfig.js";

const botEntrySchema = z.object({
  name: z.string().min(1).max(100),
  token: z.string().min(1),
  channelId: z.string().min(1),
});

const relayConfigSchema = z.object({
  livekitUrl: z.string().url(),
  livekitApiKey: z.string(),
  livekitApiSecret: z.string(),
  roomName: z.string().min(1).max(100),
  guildId: z.string(),
  bots: z.array(botEntrySchema),
});

function basicAuth(adminSecret: string | undefined): string | undefined {
  if (!adminSecret) return undefined;
  return `Basic ${Buffer.from(`admin:${adminSecret}`).toString("base64")}`;
}

export async function registerRelayBotsRoutes(app: FastifyInstance): Promise<void> {
  // ── Admin: relay bots config CRUD ────────────────────────────────────────────
  // Gated by the admin web UI cookie session (requireAdminSession).

  app.get("/admin/relay-bots/config", async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const config = await getRelayBotsConfig(session.guildId);
    // Redact bot tokens for vice admirals; only admirals see full tokens.
    const bots =
      session.role === "admiral"
        ? config.bots
        : config.bots.map((b) => ({ ...b, token: "•••" }));
    return reply.send({ ...config, bots });
  });

  app.post("/admin/relay-bots/config", async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const parsed = relayConfigSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    await setRelayBotsConfig(session.guildId, { ...parsed.data, guildId: session.guildId }, session.sub);
    await notifyRelayBotsReload();
    return reply.send({ ok: true });
  });

  // ── Admin: relay bots service proxy endpoints ─────────────────────────────────
  // Proxied from the relay bots service (RELAY_BOTS_ADMIN_URL).

  app.get("/admin/relay-bots/metrics", async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const env = getEnv();
    if (!env.RELAY_BOTS_ADMIN_URL) {
      return reply.send({ offline: true });
    }
    try {
      const auth = basicAuth(env.RELAY_BOTS_ADMIN_SECRET);
      const res = await fetch(`${env.RELAY_BOTS_ADMIN_URL}/api/metrics`, {
        headers: auth ? { authorization: auth } : {},
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        return reply.send({ offline: true, error: `bots service returned ${res.status}` });
      }
      return reply.send(await res.json() as unknown);
    } catch (err) {
      return reply.send({ offline: true, error: String(err) });
    }
  });

  app.post("/admin/relay-bots/restart", async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const env = getEnv();
    if (!env.RELAY_BOTS_ADMIN_URL) {
      return reply.code(503).send({ error: "relay_bots_not_configured" });
    }
    try {
      const auth = basicAuth(env.RELAY_BOTS_ADMIN_SECRET);
      const res = await fetch(`${env.RELAY_BOTS_ADMIN_URL}/api/restart`, {
        method: "POST",
        headers: auth ? { authorization: auth } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return reply.code(502).send({ error: `bots service returned ${res.status}` });
      }
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(502).send({ error: String(err) });
    }
  });

  // ── Service config endpoint ───────────────────────────────────────────────────
  // The relay bots service polls this to get its full config. Auth: Bearer
  // RELAY_BOTS_SECRET (set as an env var on both the bridge and the bots service).

  app.get("/relay-bots/service-config", async (request, reply) => {
    const secret = getEnv().RELAY_BOTS_SECRET;
    if (!secret) {
      return reply.code(503).send({ error: "service_config_not_enabled" });
    }
    const auth = (request.headers.authorization ?? "").trim();
    if (auth !== `Bearer ${secret}`) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const guildId = (request.query as Record<string, string | undefined>).guildId?.trim();
    if (!guildId) {
      return reply.code(400).send({ error: "guildId_required" });
    }
    const config = await getRelayBotsConfig(guildId);
    return reply.send(config);
  });
}
