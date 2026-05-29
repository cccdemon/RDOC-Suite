-- Initial PostgreSQL baseline for @rdoc-suite/fleetplanner.
-- Replaces the former SQLite migration. Mirrors prisma/schema.prisma.

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatarHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'crew',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ship" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "size" TEXT NOT NULL DEFAULT '',
    "career" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "minCrew" INTEGER NOT NULL DEFAULT 1,
    "maxCrew" INTEGER NOT NULL DEFAULT 1,
    "weaponCrew" INTEGER NOT NULL DEFAULT 0,
    "operationCrew" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "rawJson" TEXT NOT NULL DEFAULT '{}',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipSyncState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalDays" INTEGER NOT NULL DEFAULT 7,
    "lastRunAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "running" BOOLEAN NOT NULL DEFAULT false,
    "shipCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "opType" TEXT NOT NULL DEFAULT 'combat',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "discordEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationLeader" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaderRole" TEXT NOT NULL DEFAULT 'raid_leader',

    CONSTRAINT "OperationLeader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompositionGroup" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CompositionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompositionRequirement" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CompositionRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetUnit" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "unitType" TEXT NOT NULL DEFAULT 'ship',
    "shipId" TEXT,
    "squadName" TEXT,
    "squadSize" INTEGER,
    "captainId" TEXT NOT NULL,
    "requirementId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "captainNote" TEXT,
    "leaderNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatAssignment" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "seatType" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "userId" TEXT,

    CONSTRAINT "SeatAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ship_slug_key" ON "Ship"("slug");

-- CreateIndex
CREATE INDEX "Ship_name_idx" ON "Ship"("name");

-- CreateIndex
CREATE UNIQUE INDEX "OperationLeader_operationId_userId_key" ON "OperationLeader"("operationId", "userId");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLeader" ADD CONSTRAINT "OperationLeader_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLeader" ADD CONSTRAINT "OperationLeader_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionGroup" ADD CONSTRAINT "CompositionGroup_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionRequirement" ADD CONSTRAINT "CompositionRequirement_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompositionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetUnit" ADD CONSTRAINT "FleetUnit_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetUnit" ADD CONSTRAINT "FleetUnit_shipId_fkey" FOREIGN KEY ("shipId") REFERENCES "Ship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetUnit" ADD CONSTRAINT "FleetUnit_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetUnit" ADD CONSTRAINT "FleetUnit_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "CompositionRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatAssignment" ADD CONSTRAINT "SeatAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "FleetUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatAssignment" ADD CONSTRAINT "SeatAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
