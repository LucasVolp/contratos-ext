-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Contract" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "object" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierDocument" TEXT NOT NULL,
    "uasg" TEXT NOT NULL,
    "unitName" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT,
    "endDate" TEXT,
    "initialValue" DECIMAL(24,6) NOT NULL,
    "globalValue" DECIMAL(24,6) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRecord" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "processNumber" TEXT NOT NULL DEFAULT '',
    "purchaseNumber" TEXT NOT NULL DEFAULT '',
    "purchaseYear" INTEGER,
    "modality" TEXT NOT NULL DEFAULT 'PREGAO',
    "object" TEXT NOT NULL,
    "startDate" TEXT,
    "endDate" TEXT,
    "renewable" BOOLEAN NOT NULL DEFAULT false,
    "uasg" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL DEFAULT '',
    "organizationDocument" TEXT NOT NULL DEFAULT '',
    "organizationStreet" TEXT NOT NULL DEFAULT '',
    "organizationNumber" TEXT NOT NULL DEFAULT '',
    "organizationCity" TEXT NOT NULL DEFAULT '',
    "organizationState" TEXT NOT NULL DEFAULT '',
    "authorityName" TEXT NOT NULL DEFAULT '',
    "authorityRole" TEXT NOT NULL DEFAULT '',
    "authorityRegistration" TEXT NOT NULL DEFAULT '',
    "ordinanceNumber" TEXT NOT NULL DEFAULT '',
    "ordinanceDate" TEXT,
    "ordinancePublicationDate" TEXT,
    "supplierName" TEXT NOT NULL DEFAULT '',
    "supplierDocument" TEXT NOT NULL DEFAULT '',
    "supplierRepresentative" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordItem" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "brand" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" DECIMAL(24,6) NOT NULL,
    "minimumQuantity" DECIMAL(24,6) NOT NULL,
    "unitPrice" DECIMAL(24,6) NOT NULL,
    "warranty" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "RecordItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentExport" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "itemNumber" INTEGER,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contract_uasg_idx" ON "Contract"("uasg");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_number_uasg_key" ON "Contract"("number", "uasg");

-- CreateIndex
CREATE UNIQUE INDEX "PriceRecord_number_uasg_key" ON "PriceRecord"("number", "uasg");

-- CreateIndex
CREATE UNIQUE INDEX "RecordItem_recordId_number_key" ON "RecordItem"("recordId", "number");

-- AddForeignKey
ALTER TABLE "RecordItem" ADD CONSTRAINT "RecordItem_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PriceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExport" ADD CONSTRAINT "DocumentExport_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PriceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

