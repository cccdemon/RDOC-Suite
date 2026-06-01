import { prisma } from "../db.js";
import type { getOperation } from "./operations.js";
import { getBridgeVoiceStates, moveBridgeMember } from "./bridge.js";

type OpFull = NonNullable<Awaited<ReturnType<typeof getOperation>>>;

export type CrewVoiceMember = {
  userId: string; // fleetplanner User.id
  username: string;
  discordId: string | null; // null = no linked Discord identity (can't be moved)
  /** "here" = already in the unit channel, "elsewhere" = in another voice
   *  channel (can be moved), "offline" = not in any voice channel (Discord
   *  rejects a move for users not in voice). */
  location: "here" | "elsewhere" | "offline";
};

export type UnitVoiceControl = {
  unitId: string;
  channelId: string;
  channelName: string;
  crew: CrewVoiceMember[];
};

/** Map fleetplanner User.id → Discord snowflake for the given ids. */
async function discordIdMap(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.userIdentity.findMany({
    where: { userId: { in: [...new Set(userIds)] }, provider: "discord" },
    select: { userId: true, providerId: true },
  });
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.userId, r.providerId);
  // Legacy installs used the Discord snowflake directly as User.id.
  for (const id of userIds) {
    if (!map.has(id) && /^\d{16,25}$/.test(id)) map.set(id, id);
  }
  return map;
}

/** Crew of one unit = captain + seat-assigned users (deduped). */
function unitCrew(unit: OpFull["units"][number]): Array<{ userId: string; username: string }> {
  const out = new Map<string, string>();
  out.set(unit.captainId, unit.captain.username);
  for (const seat of unit.seats) {
    if (seat.active && seat.userId && seat.user) out.set(seat.userId, seat.user.username);
  }
  return [...out].map(([userId, username]) => ({ userId, username }));
}

/**
 * Build the per-unit voice-control view: for each unit that has a Discord
 * voice channel, its crew + each member's current voice location. Reads a
 * single bridge voice-states snapshot. Best-effort: on bridge error every
 * member shows "offline" (the move buttons still render; the action surfaces
 * its own error).
 */
export async function buildOpVoiceControl(op: OpFull): Promise<UnitVoiceControl[]> {
  const channelByUnit = new Map(op.voiceChannels.map((vc) => [vc.unitId, vc]));
  const unitsWithChannels = op.units.filter((u) => channelByUnit.has(u.id));
  if (unitsWithChannels.length === 0) return [];

  const allUserIds = unitsWithChannels.flatMap((u) => unitCrew(u).map((c) => c.userId));
  const discordMap = await discordIdMap(allUserIds);

  // Current voice location per Discord user (snapshot). Tolerate bridge down.
  const currentChannel = new Map<string, string | null>();
  try {
    const voice = await getBridgeVoiceStates(op.guildId);
    for (const vs of voice.voiceStates) currentChannel.set(vs.userId, vs.channelId);
  } catch {
    // leave empty → everyone shows offline
  }

  return unitsWithChannels.map((unit) => {
    const vc = channelByUnit.get(unit.id)!;
    const crew: CrewVoiceMember[] = unitCrew(unit).map((c) => {
      const discordId = discordMap.get(c.userId) ?? null;
      let location: CrewVoiceMember["location"] = "offline";
      if (discordId && currentChannel.has(discordId)) {
        location = currentChannel.get(discordId) === vc.channelId ? "here" : "elsewhere";
      }
      return { userId: c.userId, username: c.username, discordId, location };
    });
    return { unitId: unit.id, channelId: vc.channelId, channelName: vc.channelName || vc.channelId, crew };
  });
}

export type MoveResult = { moved: number; skipped: number; failed: number };

/** Move every linked crew member of a unit into that unit's Discord voice
 *  channel. Members with no Discord identity, or not currently in any voice
 *  channel, are skipped (Discord rejects moving a user who isn't in voice). */
export async function moveUnitCrewToChannel(op: OpFull, unitId: string): Promise<MoveResult> {
  const vc = op.voiceChannels.find((c) => c.unitId === unitId);
  const unit = op.units.find((u) => u.id === unitId);
  if (!vc || !unit) throw new Error("unit has no voice channel");

  const crew = unitCrew(unit);
  const discordMap = await discordIdMap(crew.map((c) => c.userId));
  const voice = await getBridgeVoiceStates(op.guildId);
  const inVoice = new Set(voice.voiceStates.filter((v) => v.channelId).map((v) => v.userId));

  let moved = 0, skipped = 0, failed = 0;
  for (const c of crew) {
    const discordId = discordMap.get(c.userId);
    if (!discordId || !inVoice.has(discordId)) { skipped++; continue; }
    try {
      await moveBridgeMember(op.guildId, discordId, vc.channelId);
      moved++;
    } catch {
      failed++;
    }
  }
  return { moved, skipped, failed };
}

/** Move a single crew member into their unit's Discord voice channel. */
export async function moveOpMemberToUnit(op: OpFull, unitId: string, fleetUserId: string): Promise<void> {
  const vc = op.voiceChannels.find((c) => c.unitId === unitId);
  if (!vc) throw new Error("unit has no voice channel");
  const discordMap = await discordIdMap([fleetUserId]);
  const discordId = discordMap.get(fleetUserId);
  if (!discordId) throw new Error("member has no linked Discord identity");
  await moveBridgeMember(op.guildId, discordId, vc.channelId);
}
