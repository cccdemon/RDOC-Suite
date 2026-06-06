import { z } from "zod";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/config/env.js → service root is two levels up. The engine bundle is
// built to engine/dist/index.html and shipped next to the compiled service.
const serviceRoot = path.resolve(here, "..", "..");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3300),
  HOST: z.string().default("0.0.0.0"),

  // M2M shared secret protecting /v1/* (the render API). Fail closed: required.
  // Same shape/length convention as BRIDGE_FLEET_SECRET.
  MISSIONCOVER_SERVICE_SECRET: z.string().min(32),

  // Public base URL the service is reachable under (used to build image links).
  // In prod: https://suite.raumdock.org/cover
  MISSIONCOVER_PUBLIC_URL: z.string().default("http://localhost:3300"),

  // Where rendered artifacts (png + meta) live. Mount a volume here in prod.
  DATA_DIR: z.string().default(path.join(serviceRoot, "data", "covers")),

  // Absolute path to the built engine single-file HTML.
  ENGINE_HTML: z.string().default(path.join(serviceRoot, "engine", "dist", "index.html")),

  // Render guardrails.
  RENDER_TIMEOUT_MS: z.coerce.number().default(20000),
  RENDER_SCALE: z.coerce.number().min(1).max(4).default(2),
  MAX_DIMENSION: z.coerce.number().default(4000),
  // Editor saves carry full-res background + custom-logo data URLs, so the
  // request body can be large. Operator-gated (token), so allow generous size.
  MAX_PAYLOAD_BYTES: z.coerce.number().default(32 * 1024 * 1024),

  // Comma-separated host allowlist for images the headless browser may fetch
  // (e.g. guild logo CDN). Empty = block all external egress (data: only).
  ALLOWED_IMAGE_HOSTS: z.string().default(""),
});

export type Env = z.infer<typeof schema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    const result = schema.safeParse(process.env);
    if (!result.success) {
      console.error("Invalid environment variables:", result.error.flatten().fieldErrors);
      process.exit(1);
    }
    _env = result.data;
  }
  return _env;
}

export function allowedImageHosts(): string[] {
  return getEnv()
    .ALLOWED_IMAGE_HOSTS.split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}
