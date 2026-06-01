-- CreateTable: manually-added mission voice commanders
CREATE TABLE "MissionVoiceParticipant" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionVoiceParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MissionVoiceParticipant_operationId_userId_key" ON "MissionVoiceParticipant"("operationId", "userId");
CREATE INDEX "MissionVoiceParticipant_operationId_idx" ON "MissionVoiceParticipant"("operationId");
CREATE INDEX "MissionVoiceParticipant_userId_idx" ON "MissionVoiceParticipant"("userId");

-- AddForeignKey
ALTER TABLE "MissionVoiceParticipant" ADD CONSTRAINT "MissionVoiceParticipant_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissionVoiceParticipant" ADD CONSTRAINT "MissionVoiceParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
