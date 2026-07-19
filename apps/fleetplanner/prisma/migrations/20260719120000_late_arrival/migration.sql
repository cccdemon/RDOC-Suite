-- Late-arrival ("nachkommen"): estimated arrival clock time HH:MM (null = on time).
ALTER TABLE "FleetUnit" ADD COLUMN "lateEta" TEXT;
ALTER TABLE "SeatAssignment" ADD COLUMN "lateEta" TEXT;
ALTER TABLE "CqbSignup" ADD COLUMN "lateEta" TEXT;
