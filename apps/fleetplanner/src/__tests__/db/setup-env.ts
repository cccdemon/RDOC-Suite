// Per-worker env for DB tests — must run before app/prisma import so the
// Prisma client constructs against the Docker test database.
import { TEST_DATABASE_URL } from "./testdb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-that-is-at-least-32-chars!!";
process.env.NODE_ENV = "test";
process.env.LIVEKIT_URL = "ws://localhost:7880";
process.env.LIVEKIT_API_KEY = "devkey";
process.env.LIVEKIT_API_SECRET = "devsecret-devsecret-devsecret-1234";
