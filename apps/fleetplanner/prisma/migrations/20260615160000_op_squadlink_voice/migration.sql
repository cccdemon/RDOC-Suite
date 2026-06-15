-- FR SquadLink-CommandNet: per-operation toggle for the SquadLink Lite voice deep-link.
ALTER TABLE "Operation" ADD COLUMN "squadLinkVoiceEnabled" BOOLEAN NOT NULL DEFAULT false;
