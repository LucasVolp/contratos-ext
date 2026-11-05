-- DropIndex
DROP INDEX "PriceRecord_number_uasg_key";

-- AlterTable
ALTER TABLE "PriceRecord" ADD COLUMN     "sourcePublicRecordId" UUID,
ADD COLUMN     "sourceSupplierDocument" TEXT;

-- CreateTable
CREATE TABLE "PublicPurchase" (
    "id" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "pncpId" TEXT,
    "number" TEXT NOT NULL,
    "year" INTEGER,
    "uasg" TEXT NOT NULL,
    "unitName" TEXT NOT NULL DEFAULT '',
    "object" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "srp" BOOLEAN,
    "processNumber" TEXT NOT NULL DEFAULT '',
    "organizationName" TEXT NOT NULL DEFAULT '',
    "organizationDocument" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "estimatedValue" DECIMAL(36,12),
    "awardedValue" DECIMAL(36,12),
    "publishedAt" TEXT,
    "openingAt" TEXT,
    "closingAt" TEXT,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detailsSyncedAt" TIMESTAMP(3),
    "recordsSyncedAt" TIMESTAMP(3),

    CONSTRAINT "PublicPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicRecord" (
    "id" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "uasg" TEXT NOT NULL,
    "unitName" TEXT NOT NULL DEFAULT '',
    "organizationName" TEXT NOT NULL DEFAULT '',
    "purchaseExternalId" TEXT,
    "purchasePncpId" TEXT,
    "purchaseNumber" TEXT NOT NULL DEFAULT '',
    "purchaseYear" INTEGER,
    "object" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT,
    "endDate" TEXT,
    "totalValue" DECIMAL(36,12),
    "itemsCount" INTEGER,
    "situation" TEXT NOT NULL DEFAULT '',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detailsSyncedAt" TIMESTAMP(3),

    CONSTRAINT "PublicRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSupplement" (
    "id" UUID NOT NULL,
    "publicRecordId" UUID NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '[]',
    "lastSyncedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "CatalogSupplement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicPurchase_externalId_key" ON "PublicPurchase"("externalId");

-- CreateIndex
CREATE INDEX "PublicPurchase_uasg_publishedAt_idx" ON "PublicPurchase"("uasg", "publishedAt");

-- CreateIndex
CREATE INDEX "PublicPurchase_pncpId_idx" ON "PublicPurchase"("pncpId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicRecord_externalId_key" ON "PublicRecord"("externalId");

-- CreateIndex
CREATE INDEX "PublicRecord_uasg_startDate_endDate_idx" ON "PublicRecord"("uasg", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "PublicRecord_purchaseExternalId_idx" ON "PublicRecord"("purchaseExternalId");

-- CreateIndex
CREATE INDEX "PublicRecord_purchasePncpId_idx" ON "PublicRecord"("purchasePncpId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogSupplement_publicRecordId_itemNumber_kind_key" ON "CatalogSupplement"("publicRecordId", "itemNumber", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PriceRecord_number_uasg_supplierDocument_key" ON "PriceRecord"("number", "uasg", "supplierDocument");

-- CreateIndex
CREATE UNIQUE INDEX "PriceRecord_sourcePublicRecordId_sourceSupplierDocument_key" ON "PriceRecord"("sourcePublicRecordId", "sourceSupplierDocument");

-- AddForeignKey
ALTER TABLE "CatalogSupplement" ADD CONSTRAINT "CatalogSupplement_publicRecordId_fkey" FOREIGN KEY ("publicRecordId") REFERENCES "PublicRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

