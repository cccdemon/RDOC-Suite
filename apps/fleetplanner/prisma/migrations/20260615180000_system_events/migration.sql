-- Admin "System & Logs" panel: persisted system events (sync runs, scheduler
-- ticks, unhandled 5xx, health transitions). Pruned to a 10-day window.

CREATE TABLE "SystemEvent" (
  "id" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'info',
  "category" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "detail" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SystemEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemEvent_createdAt_idx" ON "SystemEvent"("createdAt");
CREATE INDEX "SystemEvent_category_createdAt_idx" ON "SystemEvent"("category", "createdAt");
CREATE INDEX "SystemEvent_level_createdAt_idx" ON "SystemEvent"("level", "createdAt");
