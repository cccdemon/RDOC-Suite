// Find-or-create a User via a provider identity.
// Handles: new user creation, returning users, superadmin bootstrap,
// and linking a new identity to an already-logged-in user.

import { prisma } from "../db.js";
import { getEnv } from "../config/env.js";
import type { ExternalProfile } from "./providers.js";
import { syncUserGuildMemberships } from "../services/guilds.js";

export type IdentityResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "account_disabled" | "already_linked_to_another" };

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
    if (profile.provider === "discord") {
      await maybeSuperadmin(existing.user.id, profile.providerId);
    }
    await prisma.user.update({
      where: { id: existing.user.id },
      data: { lastSeenAt: new Date(), username: profile.username },
    });
    if (profile.provider === "discord" && profile.discordGuildIds) {
      await syncUserGuildMemberships(existing.user.id, profile.discordGuildIds).catch(() => {});
    }
    return { ok: true, userId: existing.user.id };
  }

  // No existing identity — create a fresh user + identity
  const env = getEnv();
  const isSuperadmin =
    profile.provider === "discord" && env.SUPERADMIN_DISCORD_ID === profile.providerId;

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
  if (profile.provider === "discord" && profile.discordGuildIds) {
    await syncUserGuildMemberships(user.id, profile.discordGuildIds).catch(() => {});
  }
  return { ok: true, userId: user.id };
}

/**
 * Link a new OAuth identity to an existing user (e.g. a GitHub user
 * wants to also link their Discord). Fails if the identity is already
 * claimed by a different user.
 */
export async function linkIdentity(
  userId: string,
  profile: ExternalProfile,
): Promise<IdentityResult> {
  const existing = await prisma.userIdentity.findUnique({
    where: { provider_providerId: { provider: profile.provider, providerId: profile.providerId } },
  });

  if (existing) {
    if (existing.userId === userId) {
      // Already linked to this user — update display info and return ok.
      await prisma.userIdentity.update({
        where: { id: existing.id },
        data: { username: profile.username, email: profile.email, avatarUrl: profile.avatarUrl },
      });
      return { ok: true, userId };
    }
    return { ok: false, reason: "already_linked_to_another" };
  }

  await prisma.userIdentity.create({
    data: {
      userId,
      provider: profile.provider,
      providerId: profile.providerId,
      username: profile.username,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
    },
  });
  // If linking Discord + matches SUPERADMIN_DISCORD_ID → promote
  if (profile.provider === "discord") {
    await maybeSuperadmin(userId, profile.providerId);
    if (profile.discordGuildIds) {
      await syncUserGuildMemberships(userId, profile.discordGuildIds).catch(() => {});
    }
  }
  return { ok: true, userId };
}

async function maybeSuperadmin(userId: string, discordId: string): Promise<void> {
  const env = getEnv();
  if (!env.SUPERADMIN_DISCORD_ID || env.SUPERADMIN_DISCORD_ID !== discordId) return;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role === "superadmin") return;
  await prisma.user.update({ where: { id: userId }, data: { role: "superadmin" } });
}
