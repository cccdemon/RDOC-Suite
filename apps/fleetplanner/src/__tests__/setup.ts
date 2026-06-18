// Runs before any test module is imported.
// Sets env vars so getEnv() succeeds without hitting process.exit(1).
process.env.SESSION_SECRET = "test-secret-that-is-at-least-32-chars!!";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/fleetplanner_test";
process.env.NODE_ENV = "test";
