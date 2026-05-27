// Runs before any test module is imported.
// Sets env vars so getEnv() (called eagerly by the logger) succeeds.
process.env.SESSION_SECRET = "test-secret-this-is-at-least-32-chars!";
process.env.LOG_LEVEL = "fatal";
process.env.BRIDGE_HOST = "127.0.0.1";
process.env.BRIDGE_PORT = "0";
process.env.LIVEKIT_URL = "ws://localhost:7880";
process.env.LIVEKIT_API_KEY = "devkey";
process.env.LIVEKIT_API_SECRET = "secret-secret-secret-secret-secret-1234";
