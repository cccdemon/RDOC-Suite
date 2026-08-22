import { z } from "zod";

// ── Author credit (Vi5E). Fixed, ships in every response + /about. ───────────
export const AUTHOR_CREDIT = {
  name: "Vi5E",
  website: "https://www.vi5e.net/",
  twitch: "https://www.twitch.tv/vi5e/",
  youtube: "https://www.youtube.com/@Vi5E_",
} as const;

// Cover aspect formats the engine understands.
export const coverFormatSchema = z.enum(["16:9", "1:1", "9:16", "4:3", "custom"]);
export type CoverFormat = z.infer<typeof coverFormatSchema>;

// Look presets shipped by the engine (defaultTemplates ids).
export const presetSchema = z.enum(["fleet-ops", "black-ops", "exploration", "outlaw"]);
export type CoverPreset = z.infer<typeof presetSchema>;

const httpUrl = z.string().url().refine((u) => /^https?:\/\//.test(u), "must be http(s)");
const dataOrHttpImage = z
  .string()
  .refine((s) => s.startsWith("data:image/") || /^https?:\/\//.test(s), "must be a data:image or http(s) URL");

// Asset / unit row shown in the cover's asset list.
const coverAssetSchema = z.object({
  name: z.string().max(120),
  role: z.string().max(120).optional(),
});

// Branding overlay. Defaults to CCO when omitted (see prefill.ts).
const coverBrandingSchema = z.object({
  footerTitle: z.string().max(200).optional(),
  securityText: z.string().max(200).optional(),
  fileCode: z.string().max(120).optional(),
  guildLogoUrl: dataOrHttpImage.optional(),
});

// The op payload the fleetplanner sends. All optional but title.
export const coverDataSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  tagline: z.string().max(200).optional(),
  objectiveTitle: z.string().max(120).optional(),
  objectiveText: z.string().max(2000).optional(),
  dateTime: z.string().max(120).optional(),
  location: z.string().max(200).optional(),
  assets: z.array(coverAssetSchema).max(24).optional(),
  briefingUrl: httpUrl.optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  backgroundImage: dataOrHttpImage.optional(),
  branding: coverBrandingSchema.optional(),
});
export type CoverData = z.infer<typeof coverDataSchema>;

export const coverRequestSchema = z.object({
  opId: z.string().min(1).max(64),
  format: coverFormatSchema.default("16:9"),
  preset: presetSchema.default("fleet-ops"),
  data: coverDataSchema,
  // Optional full engine config override (e.g. coming back from the editor).
  // Opaque to the service; merged over the prefill base.
  config: z.record(z.unknown()).optional(),
});
export type CoverRequest = z.infer<typeof coverRequestSchema>;

export type CoverMeta = {
  id: string;
  opId: string;
  width: number;
  height: number;
  preset: CoverPreset;
  format: CoverFormat;
  createdAt: string;
};

export type CoverResponse = CoverMeta & {
  urls: { png: string };
  author: typeof AUTHOR_CREDIT;
};
