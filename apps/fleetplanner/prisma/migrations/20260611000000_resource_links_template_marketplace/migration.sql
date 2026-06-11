-- FR-P3: operator-curated tutorial/resource links on an operation.
CREATE TABLE "OperationResourceLink" (
    "id"          TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "url"         TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "kind"        TEXT NOT NULL DEFAULT 'link',
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "addedById"   TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationResourceLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperationResourceLink_operationId_idx" ON "OperationResourceLink"("operationId");
CREATE INDEX "OperationResourceLink_addedById_idx" ON "OperationResourceLink"("addedById");

ALTER TABLE "OperationResourceLink" ADD CONSTRAINT "OperationResourceLink_operationId_fkey"
    FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationResourceLink" ADD CONSTRAINT "OperationResourceLink_addedById_fkey"
    FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FR-P4: shareable operation blueprints (template marketplace).
CREATE TABLE "OperationTemplate" (
    "id"            TEXT NOT NULL,
    "ownerGuildId"  TEXT NOT NULL,
    "createdById"   TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "summary"       TEXT NOT NULL DEFAULT '',
    "opType"        TEXT NOT NULL DEFAULT 'combat',
    "visibility"    TEXT NOT NULL DEFAULT 'guild',
    "blueprintJson" TEXT NOT NULL,
    "sourceOpId"    TEXT,
    "usageCount"    INTEGER NOT NULL DEFAULT 0,
    "published"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperationTemplate_visibility_opType_idx" ON "OperationTemplate"("visibility", "opType");
CREATE INDEX "OperationTemplate_ownerGuildId_idx" ON "OperationTemplate"("ownerGuildId");

ALTER TABLE "OperationTemplate" ADD CONSTRAINT "OperationTemplate_ownerGuildId_fkey"
    FOREIGN KEY ("ownerGuildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationTemplate" ADD CONSTRAINT "OperationTemplate_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
