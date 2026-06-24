-- Session hardening: the cookie now carries a random 32-byte bearer token and the
-- DB stores only its SHA-256 hash (never the token, and no longer the cuid PK as
-- the secret). Additive + nullable so existing rows survive the migration; they
-- have no hash and become unmatchable (one-time logout-all). Postgres unique
-- indexes permit multiple NULLs, so legacy rows don't collide.
ALTER TABLE "UserSession" ADD COLUMN "tokenHash" TEXT;

CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
