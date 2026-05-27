import { z } from "zod";
import type { ClientMessage, ServerMessage } from "./protocol.js";

// Discord snowflake IDs are numeric strings of length 17-20.
const snowflake = z.string().regex(/^[0-9]{17,20}$/, "expected Discord snowflake id");

const commanderInfoSchema = z.object({
  userId: snowflake,
  displayName: z.string().min(1).max(100).optional(),
  voiceChannelId: snowflake.optional(),
  active: z.boolean(),
  speaking: z.boolean(),
  outputMuted: z.boolean().optional(),
  afk: z.boolean().optional(),
});

const pttStartSchema = z.object({
  type: z.literal("ptt:start"),
  guildId: snowflake,
  voiceChannelId: snowflake.optional(),
});

const pttStopSchema = z.object({
  type: z.literal("ptt:stop"),
  guildId: snowflake,
});

const heartbeatSchema = z.object({
  type: z.literal("heartbeat"),
  timestamp: z.number().int().nonnegative(),
});

const deviceUpdateSchema = z.object({
  type: z.literal("device:update"),
  inputDeviceId: z.string().min(1).max(256),
});

const statusOutputMuteSchema = z.object({
  type: z.literal("status:output-mute"),
  muted: z.boolean(),
});

const statusAfkSchema = z.object({
  type: z.literal("status:afk"),
  afk: z.boolean(),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  pttStartSchema,
  pttStopSchema,
  heartbeatSchema,
  deviceUpdateSchema,
  statusOutputMuteSchema,
  statusAfkSchema,
]);

const bridgeJoinedSchema = z.object({
  type: z.literal("bridge:joined"),
  roomId: z.string().min(1).max(256),
  guildName: z.string().min(1).max(200).optional(),
  activeCommanders: z.array(commanderInfoSchema),
  // Optional: only present when the user is in an allowed voice channel
  // at WS-connect time. Otherwise an audio:enable arrives later.
  livekitUrl: z.string().url().optional(),
  livekitToken: z.string().min(1).optional(),
});

const bridgeLeftSchema = z.object({
  type: z.literal("bridge:left"),
  roomId: z.string().min(1).max(256),
});

const commanderListSchema = z.object({
  type: z.literal("commander:list"),
  roomId: z.string().min(1).max(256),
  commanders: z.array(commanderInfoSchema),
});

const audioEnableSchema = z.object({
  type: z.literal("audio:enable"),
  roomId: z.string().min(1).max(256),
  livekitUrl: z.string().url(),
  livekitToken: z.string().min(1),
});

const audioDisableSchema = z.object({
  type: z.literal("audio:disable"),
  reason: z.enum(["not_in_voice", "outside_allowed_voice_channel"]),
});

const errorMessageSchema = z.object({
  type: z.literal("error"),
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(500),
});

export const serverMessageSchema = z.discriminatedUnion("type", [
  bridgeJoinedSchema,
  bridgeLeftSchema,
  commanderListSchema,
  audioEnableSchema,
  audioDisableSchema,
  errorMessageSchema,
]);

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseClientMessage(input: unknown): ParseResult<ClientMessage> {
  const result = clientMessageSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data as ClientMessage };
  }
  return { ok: false, error: summarizeZodError(result.error) };
}

export function parseServerMessage(input: unknown): ParseResult<ServerMessage> {
  const result = serverMessageSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data as ServerMessage };
  }
  return { ok: false, error: summarizeZodError(result.error) };
}

function summarizeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}
