-- FR-P1 step 6: cache Fleetyards.net ship data locally (silhouette + hardpoints)
-- for the seat/turret card. Loose link to Ship by normalized name.

CREATE TABLE "FleetyardsShip" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "nameKey" TEXT NOT NULL DEFAULT '',
    "silhouetteUrl" TEXT,
    "storeImageUrl" TEXT,
    "hardpointsJson" TEXT NOT NULL DEFAULT '[]',
    "rawJson" TEXT NOT NULL DEFAULT '{}',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetyardsShip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetyardsShip_slug_key" ON "FleetyardsShip"("slug");
CREATE INDEX "FleetyardsShip_nameKey_idx" ON "FleetyardsShip"("nameKey");

CREATE TABLE "FleetyardsSyncState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalDays" INTEGER NOT NULL DEFAULT 7,
    "lastRunAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "running" BOOLEAN NOT NULL DEFAULT false,
    "shipCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetyardsSyncState_pkey" PRIMARY KEY ("id")
);
