import { getEnv } from "../config/env.js";
import { prisma } from "../db.js";
import {
  discordInviteUrl,
  fetchBotIdentity,
  fetchGuildMemberByBot,
  fetchGuildRolesByBot,
} from "./discord.js";

const ADMINISTRATOR = 1n << 3n;
const MANAGE_CHANNELS = 1n << 4n;
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const READ_MESSAGE_HISTORY = 1n << 16n;
const CONNECT = 1n << 20n;
const SPEAK = 1n << 21n;
const MOVE_MEMBERS = 1n << 24n;
const MANAGE_ROLES = 1n << 28n;
const MANAGE_EVENTS = 1n << 33n;
const ADD_EVENTS = 1n << 44n;

export type BotDiagnostic = {
  key: string;
  name: string;
  appId: string | null;
  configured: boolean;
  installed: boolean;
  ok: boolean;
  severity: "ok" | "warn" | "error";
  username: string | null;
  requiredPermissions: Array<{ key: string; label: string; bit: string }>;
  missingPermissions: Array<{ key: string; label: string; bit: string }>;
  inviteUrl: string | null;
  note: string;
};

export type DiscordInstallDiagnostics = {
  guild: { id: string; name: string };
  canInspectPermissions: boolean;
  summary: { ok: number; warn: number; error: number };
  bots: BotDiagnostic[];
};

type RequiredPermission = { key: string; label: string; bit: bigint };

const FLEETPLANNER_PERMS: RequiredPermission[] = [
  { key: "VIEW_CHANNEL", label: "View Channels", bit: VIEW_CHANNEL },
  { key: "SEND_MESSAGES", label: "Send Messages", bit: SEND_MESSAGES },
  { key: "READ_MESSAGE_HISTORY", label: "Read Message History", bit: READ_MESSAGE_HISTORY },
  { key: "MANAGE_ROLES", label: "Manage Roles", bit: MANAGE_ROLES },
  { key: "MANAGE_EVENTS", label: "Manage Events", bit: MANAGE_EVENTS },
  { key: "ADD_EVENTS", label: "Add Events", bit: ADD_EVENTS },
];

function permissionBits(perms: RequiredPermission[]): string {
  return perms.reduce((acc, perm) => acc | perm.bit, 0n).toString();
}

function serializePerms(perms: RequiredPermission[]) {
  return perms.map((perm) => ({ key: perm.key, label: perm.label, bit: perm.bit.toString() }));
}

function computePermissions(guildId: string, roleIds: string[], roles: Array<{ id: string; permissions: string }>): bigint | null {
  const byId = new Map(roles.map((role) => [role.id, role]));
  const effectiveRoleIds = new Set<string>([guildId, ...roleIds]);
  let bits = 0n;
  for (const roleId of effectiveRoleIds) {
    const role = byId.get(roleId);
    if (!role) continue;
    bits |= BigInt(role.permissions);
  }
  if ((bits & ADMINISTRATOR) === ADMINISTRATOR) return (1n << 53n) - 1n;
  return bits;
}

function missingPermissions(actual: bigint | null, required: RequiredPermission[]): RequiredPermission[] {
  if (actual === null) return required;
  return required.filter((perm) => (actual & perm.bit) !== perm.bit);
}

async function checkBot(input: {
  guildId: string;
  key: string;
  name: string;
  appId: string | null;
  token?: string | null;
  required: RequiredPermission[];
  roles: Array<{ id: string; permissions: string }> | null;
  applicationsCommands?: boolean;
  note: string;
}): Promise<BotDiagnostic> {
  const requiredPermissions = serializePerms(input.required);
  const base = {
    key: input.key,
    name: input.name,
    appId: input.appId,
    requiredPermissions,
    inviteUrl: input.appId
      ? discordInviteUrl({
          clientId: input.appId,
          permissions: permissionBits(input.required),
          guildId: input.guildId,
          applicationsCommands: input.applicationsCommands,
        })
      : null,
  };

  if (!input.appId || !input.token) {
    return {
      ...base,
      configured: false,
      installed: false,
      ok: false,
      severity: "error",
      username: null,
      missingPermissions: requiredPermissions,
      note: `${input.note} Environment variables for this bot are missing.`,
    };
  }

  const identity = await fetchBotIdentity(input.token).catch(() => null);
  if (!identity) {
    return {
      ...base,
      configured: true,
      installed: false,
      ok: false,
      severity: "error",
      username: null,
      missingPermissions: requiredPermissions,
      note: `${input.note} The configured bot token is invalid.`,
    };
  }

  if (identity.id !== input.appId) {
    return {
      ...base,
      configured: true,
      installed: false,
      ok: false,
      severity: "error",
      username: identity.username,
      missingPermissions: requiredPermissions,
      note: `${input.note} Token identity is ${identity.id}, but expected ${input.appId}.`,
    };
  }

  const member = await fetchGuildMemberByBot(input.guildId, input.appId).catch(() => null);
  if (!member) {
    return {
      ...base,
      configured: true,
      installed: false,
      ok: false,
      severity: "error",
      username: identity.username,
      missingPermissions: requiredPermissions,
      note: `${input.note} Bot is not installed on this Discord server.`,
    };
  }

  const bits = input.roles ? computePermissions(input.guildId, member.roles ?? [], input.roles) : null;
  const missing = missingPermissions(bits, input.required);
  return {
    ...base,
    configured: true,
    installed: true,
    ok: missing.length === 0,
    severity: missing.length === 0 ? "ok" : "warn",
    username: member.user?.username ?? identity.username,
    missingPermissions: serializePerms(missing),
    note: missing.length === 0
      ? input.note
      : `${input.note} Bot is installed, but its Discord role is missing required permissions.`,
  };
}

export async function runDiscordInstallDiagnostics(guildId: string): Promise<DiscordInstallDiagnostics> {
  const env = getEnv();
  const guild = await prisma.guild.findUnique({ where: { id: guildId }, select: { id: true, name: true } });
  if (!guild) throw new Error("Guild not found");

  const roles = await fetchGuildRolesByBot(guildId).catch(() => null);

  const checks: BotDiagnostic[] = [];
  checks.push(await checkBot({
    guildId,
    key: "rdoc-fleetplanner",
    name: "RDOC-Fleetplanner",
    appId: env.DISCORD_FLEETPLANNER_CLIENT_ID ?? null,
    token: env.DISCORD_FLEETPLANNER_BOT_TOKEN ?? null,
    required: FLEETPLANNER_PERMS,
    roles,
    applicationsCommands: true,
    note: "Required for Fleetplanner events, DMs, feedback tickets, and event roles.",
  }));

  return {
    guild,
    canInspectPermissions: roles !== null,
    summary: {
      ok: checks.filter((check) => check.severity === "ok").length,
      warn: checks.filter((check) => check.severity === "warn").length,
      error: checks.filter((check) => check.severity === "error").length,
    },
    bots: checks,
  };
}
