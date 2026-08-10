import { buildApp } from "./app.js";
import { assertDiscordEndpoints, getEnv } from "./config/env.js";
import { startShipSyncScheduler } from "./services/shipSync.js";
import { startLocationSyncScheduler } from "./services/locations.js";
import { startReminderScheduler } from "./services/reminderScheduler.js";
import { startCoverCleanupScheduler } from "./services/coverCleanup.js";
import { startRecurrenceScheduler } from "./services/recurrence.js";
import { startEventInterestScheduler } from "./services/eventInterest.js";
import { ensureFleetyardsFresh } from "./services/fleetyards.js";

const env = getEnv();
const app = await buildApp();

// Loud warning if DISCORD_API_BASE/DISCORD_SITE_BASE point away from Discord
// (only the local test stack should ever do that).
assertDiscordEndpoints(app.log);

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  // Weekly (configurable) SC-wiki ship-catalog refresh. Self-paces via
  // ShipSyncState; the first run also seeds an empty catalog.
  startShipSyncScheduler({
    info: (msg) => app.log.info(msg),
    error: (e, msg) => app.log.error(e, msg),
  });
  startLocationSyncScheduler({
    info: (msg) => app.log.info(msg),
    error: (e, msg) => app.log.error(e, msg),
  });
  startReminderScheduler({
    info: (msg) => app.log.info(msg),
    error: (e, msg) => app.log.error(e, msg),
  });
  // Purge mission covers of completed/cancelled ops older than 14 days.
  startCoverCleanupScheduler({
    info: (msg) => app.log.info(msg),
    error: (e, msg) => app.log.error(e, msg),
  });
  // FR-P3: rolling-spawn concrete ops from recurring-operation series.
  startRecurrenceScheduler({
    info: (msg) => app.log.info(msg),
    error: (e, msg) => app.log.error(e, msg),
  });
  // FR-P2: poll Discord scheduled-event "Interested" → needs-assignment (5 min).
  startEventInterestScheduler({
    info: (msg) => app.log.info(msg),
    error: (e, msg) => app.log.error(e, msg),
  });
  // FR-P1 step 6: seed/refresh the Fleetyards silhouette cache (best-effort).
  void ensureFleetyardsFresh();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
