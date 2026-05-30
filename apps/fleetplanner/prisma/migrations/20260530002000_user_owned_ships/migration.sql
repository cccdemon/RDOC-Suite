CREATE TABLE "UserShip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shipId" TEXT NOT NULL,
    "nickname" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserShip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserShip_userId_shipId_key" ON "UserShip"("userId", "shipId");
CREATE INDEX "UserShip_userId_idx" ON "UserShip"("userId");
CREATE INDEX "UserShip_shipId_idx" ON "UserShip"("shipId");

ALTER TABLE "UserShip" ADD CONSTRAINT "UserShip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserShip" ADD CONSTRAINT "UserShip_shipId_fkey" FOREIGN KEY ("shipId") REFERENCES "Ship"("id") ON DELETE CASCADE ON UPDATE CASCADE;
