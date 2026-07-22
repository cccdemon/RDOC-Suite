-- FR-P1: host-selected subset of partner guilds an op distributes to.
-- Empty array = distribute to no partners (default). Existing ops get [].
ALTER TABLE "Operation" ADD COLUMN "partnerTargetGuildIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
