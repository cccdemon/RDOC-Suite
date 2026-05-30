CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "systemSlug" TEXT NOT NULL,
    "parentName" TEXT NOT NULL DEFAULT '',
    "parentSlug" TEXT NOT NULL DEFAULT '',
    "typeName" TEXT NOT NULL DEFAULT '',
    "classification" TEXT NOT NULL DEFAULT '',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "hasResources" BOOLEAN NOT NULL DEFAULT false,
    "webUrl" TEXT,
    "rawJson" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LocationSyncState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalDays" INTEGER NOT NULL DEFAULT 7,
    "lastRunAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "running" BOOLEAN NOT NULL DEFAULT false,
    "locationCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Location_uuid_key" ON "Location"("uuid");
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");
CREATE INDEX "Location_name_idx" ON "Location"("name");
CREATE INDEX "Location_systemSlug_idx" ON "Location"("systemSlug");
CREATE INDEX "Location_classification_idx" ON "Location"("classification");
