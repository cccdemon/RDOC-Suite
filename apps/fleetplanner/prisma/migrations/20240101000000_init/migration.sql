-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "avatarHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'crew',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ship" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "opType" TEXT NOT NULL DEFAULT 'combat',
    "scheduledAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Operation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OperationLeader" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaderRole" TEXT NOT NULL DEFAULT 'raid_leader',
    CONSTRAINT "OperationLeader_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OperationLeader_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompositionGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CompositionGroup_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompositionRequirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CompositionRequirement_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompositionGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FleetUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetUnit_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FleetUnit_shipId_fkey" FOREIGN KEY ("shipId") REFERENCES "Ship" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FleetUnit_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FleetUnit_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "CompositionRequirement" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SeatAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "unitId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "seatType" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "userId" TEXT,
    CONSTRAINT "SeatAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "FleetUnit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeatAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Ship_slug_key" ON "Ship"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "OperationLeader_operationId_userId_key" ON "OperationLeader"("operationId", "userId");
