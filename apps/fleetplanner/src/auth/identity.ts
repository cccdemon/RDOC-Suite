// Find-or-create a User via a provider identity.
// Handles: new user creation, returning users, superadmin bootstrap.

import { prisma } from "../db.js";
import { getEnv } from "../config/env.js";
import type { ExternalProfile } from "./providers.js";
import { syncUserGuildMemberships } from "../services/guilds.js";
import { claimInterestShadows } from "../services/eventInterest.js";

export type IdentityResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "account_disabled" };

/**
 * Called after a successful OAuth exchange. Finds or creates both the
 * User and its UserIdentity row. Returns the userId on success.
 */
export async function resolveIdentity(profile: ExternalProfile): Promise<IdentityResult> {
  const existing = await prisma.userIdentity.findUnique({
    where: { provider_providerId: { provider: profile.provider, providerId: profile.providerId } },
    include: { user: true },
  });

  if (existing) {
    // Update display info in identity row (name/avatar can change)
    await prisma.userIdentity.update({
      where: { id: existing.id },
      data: {
        username: profile.username,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
      },
    });
    if (!existing.user.active) return { ok: false, reason: "account_disabled" };

    // Promote to superadmin if Discord ID matches SUPERADMIN_DISCORD_ID
    await maybeSuperadmin(existing.user.id, profile.providerId);
    await prisma.user.update({
      where: { id: existing.user.id },
      data: { lastSeenAt: new Date(), username: profile.username },
    });
    if (profile.discordGuildIds) {
      await syncUserGuildMemberships(existing.user.id, profile.discordGuildIds).catch(() => {});
    }
    // FR-P2: claim any shadow event-interest captured before this login.
    await claimInterestShadows(existing.user.id, profile.providerId).catch(() => {});
    return { ok: true, userId: existing.user.id };
  }

  // No existing identity — create a fresh user + identity
  const env = getEnv();
  const isSuperadmin = env.SUPERADMIN_DISCORD_ID === profile.providerId;

  const user = await prisma.user.create({
    data: {
      username: profile.username,
      avatarHash: null,
      role: isSuperadmin ? "superadmin" : "crew",
      identities: {
        create: {
          provider: profile.provider,
          providerId: profile.providerId,
          username: profile.username,
          email: profile.email,
          avatarUrl: profile.avatarUrl,
        },
      },
    },
  });
  if (profile.discordGuildIds) {
    await syncUserGuildMemberships(user.id, profile.discordGuildIds).catch(() => {});
  }
  await claimInterestShadows(user.id, profile.providerId).catch(() => {});
  return { ok: true, userId: user.id };
}

async function maybeSuperadmin(userId: string, discordId: string): Promise<void> {
  const env = getEnv();
  if (!env.SUPERADMIN_DISCORD_ID || env.SUPERADMIN_DISCORD_ID !== discordId) return;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role === "superadmin") return;
  await prisma.user.update({ where: { id: userId }, data: { role: "superadmin" } });
}
