-- CreateTable: Raumdock-wide global gates (singleton, id = "global")
CREATE TABLE "GlobalSettings" (
    "id" TEXT NOT NULL,
    "raumdockGuildId" TEXT,
    "bridgeRequiredRoleId" TEXT,
    "relayRequiredRoleId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "GlobalSettings_pkey" PRIMARY KEY ("id")
);
