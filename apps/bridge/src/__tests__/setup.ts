// Runs before any test module is imported.
// Sets env vars so getEnv() (called eagerly by the logger) succeeds.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPrisma } from "@rdoc-suite/db";

// Absolute path so Prisma finds dev.db regardless of which directory vitest
// sets as CWD. setup.ts lives at apps/bridge/src/__tests__/; the actual
// SQLite file lives at <root>/prisma/prisma/dev.db — Prisma resolves
// DATABASE_URL="file:./prisma/dev.db" relative to the schema directory
// (prisma/), so the path doubles. Forward slashes required on Windows.
const __dir = fileURLToPath(new URL(".", import.meta.url));
const dbPath = resolve(__dir, "../../../../prisma/prisma/dev.db").replace(/\\/g, "/");
process.env.DATABASE_URL = `file:${dbPath}`;

process.env.SESSION_SECRET = "test-secret-this-is-at-least-32-chars!";
process.env.LOG_LEVEL = "fatal";
process.env.BRIDGE_HOST = "127.0.0.1";
process.env.BRIDGE_PORT = "0";
process.env.LIVEKIT_URL = "ws://localhost:7880";
process.env.LIVEKIT_API_KEY = "devkey";
process.env.LIVEKIT_API_SECRET = "secret-secret-secret-secret-secret-1234";

await getPrisma().$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "GlobalSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "raumdockGuildId" TEXT,
    "bridgeRequiredRoleId" TEXT,
    "relayRequiredRoleId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT
  )
`);

await getPrisma().$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "RelayBotsConfig" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "livekitUrl" TEXT NOT NULL DEFAULT '',
    "livekitApiKey" TEXT NOT NULL DEFAULT '',
    "livekitApiSecret" TEXT NOT NULL DEFAULT '',
    "roomName" TEXT NOT NULL DEFAULT 'voice-relay',
    "botsJson" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT
  )
`);

await getPrisma().$executeRawUnsafe(`
  CREATE UNIQUE INDEX IF NOT EXISTS "RelayBotsConfig_guildId_key"
  ON "RelayBotsConfig"("guildId")
`);
