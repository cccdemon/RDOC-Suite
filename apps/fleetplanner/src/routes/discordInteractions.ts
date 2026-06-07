// FR-P1 Phase 2 — Discord HTTP interactions endpoint (event-distribution
// approval buttons). REST-only bot: no gateway. Discord POSTs button clicks
// here; we Ed25519-verify the signature, then approve/decline the
// distribution. The web inbox (/guilds/partner-events) is the source of truth
// and always works even if this endpoint is unconfigured.

import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { verifyDiscordInteraction } from "../services/discord.js";
import { approveDistribution, declineDistribution } from "../services/eventDistribution.js";

// Discord interaction + response type enums (only what we use).
const INTERACTION_PING = 1;
const INTERACTION_MESSAGE_COMPONENT = 3;
const RESP_PONG = 1;
const RESP_CHANNEL_MESSAGE = 4;
const RESP_UPDATE_MESSAGE = 7;
const EPHEMERAL = 64;

type Interaction = {
  type: number;
  data?: { custom_id?: string };
  member?: { user?: { id?: string } };
  user?: { id?: string };
};

async function fleetplannerUserIdForDiscord(discordUserId: string): Promise<string | null> {
  const identity = await prisma.userIdentity.findUnique({
    where: { provider_providerId: { provider: "discord", providerId: discordUserId } },
    select: { userId: true },
  });
  if (identity?.userId) return identity.userId;
  // Legacy installs used the Discord snowflake directly as User.id.
  const legacy = await prisma.user.findUnique({
    where: { id: discordUserId },
    select: { id: true },
  });
  return legacy?.id ?? null;
}

export async function discordInteractionRoutes(app: FastifyInstance) {
  // Keep the raw request body (needed for the Ed25519 signature). Encapsulated
  // to this plugin scope so the rest of the app's JSON parsing is unchanged.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      (req as { rawBody?: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(null, {});
      }
    },
  );

  app.post("/discord/interactions", async (req, reply) => {
    const signature = req.headers["x-signature-ed25519"];
    const timestamp = req.headers["x-signature-timestamp"];
    const rawBody = (req as { rawBody?: string }).rawBody ?? "";
    if (typeof signature !== "string" || typeof timestamp !== "string") {
      return reply.code(401).send("missing signature");
    }
    if (!verifyDiscordInteraction(rawBody, signature, timestamp)) {
      return reply.code(401).send("invalid signature");
    }

    const interaction = req.body as Interaction;

    // Discord endpoint validation handshake.
    if (interaction.type === INTERACTION_PING) {
      return reply.send({ type: RESP_PONG });
    }

    if (interaction.type === INTERACTION_MESSAGE_COMPONENT) {
      const customId = interaction.data?.custom_id ?? "";
      const [action, distId] = customId.split(":");
      const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;

      const ephemeral = (content: string) =>
        reply.send({ type: RESP_CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL } });
      const updateMessage = (content: string) =>
        reply.send({ type: RESP_UPDATE_MESSAGE, data: { content, components: [] } });

      if (!distId || (action !== "evt-share" && action !== "evt-decline")) {
        return ephemeral("Unknown action.");
      }
      if (!discordUserId) return ephemeral("Could not identify your Discord account.");

      const userId = await fleetplannerUserIdForDiscord(discordUserId);
      if (!userId) {
        return ephemeral(
          "No Fleetmanager account is linked to your Discord. Log in once at the Fleetmanager, then try the web inbox.",
        );
      }

      const result =
        action === "evt-share"
          ? await approveDistribution(distId, userId)
          : await declineDistribution(distId, userId);

      if (result.ok) {
        return updateMessage(
          action === "evt-share"
            ? "✅ Shared — the event was posted to your Discord."
            : "🚫 Declined.",
        );
      }
      const msg =
        result.reason === "forbidden"
          ? "You must be a fleetoperator of this Discord to decide."
          : result.reason === "not_pending"
            ? "This event was already decided."
            : result.reason === "post_failed"
              ? "Approved, but posting the Discord event failed — try the web inbox."
              : "This event could not be found.";
      return ephemeral(msg);
    }

    return reply.send({ type: RESP_PONG });
  });
}
