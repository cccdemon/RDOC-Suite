-- FR-P1 Event Distribution: cross-post a host op's Discord scheduled event
-- into active partner guilds. One EventDistribution row per (op, target guild);
-- directional auto-share policy in PartnerSharePolicy.

CREATE TABLE "EventDistribution" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "sourceGuildId" TEXT NOT NULL,
    "targetGuildId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "contactUserId" TEXT,
    "discordEventId" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventDistribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventDistribution_operationId_targetGuildId_key" ON "EventDistribution"("operationId", "targetGuildId");
CREATE INDEX "EventDistribution_targetGuildId_idx" ON "EventDistribution"("targetGuildId");
CREATE INDEX "EventDistribution_status_idx" ON "EventDistribution"("status");

ALTER TABLE "EventDistribution" ADD CONSTRAINT "EventDistribution_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PartnerSharePolicy" (
    "ownerGuildId" TEXT NOT NULL,
    "partnerGuildId" TEXT NOT NULL,
    "autoShare" BOOLEAN NOT NULL DEFAULT false,
    "defaultContactUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerSharePolicy_pkey" PRIMARY KEY ("ownerGuildId", "partnerGuildId")
);

CREATE INDEX "PartnerSharePolicy_partnerGuildId_idx" ON "PartnerSharePolicy"("partnerGuildId");
