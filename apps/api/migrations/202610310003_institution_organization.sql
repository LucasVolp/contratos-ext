-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "organization" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Institution_organization_idx" ON "Institution"("organization");
