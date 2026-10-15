-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "recurringInvoiceId" UUID;

-- CreateTable
CREATE TABLE "ReminderSent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "stage" "ReminderStage" NOT NULL,
    "channels" "MessageChannel"[] DEFAULT ARRAY[]::"MessageChannel"[],
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderSent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReminderSent_tenantId_sentAt_idx" ON "ReminderSent"("tenantId", "sentAt");

-- CreateIndex
CREATE INDEX "ReminderSent_invoiceId_idx" ON "ReminderSent"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderSent_ruleId_invoiceId_key" ON "ReminderSent"("ruleId", "invoiceId");

-- CreateIndex
CREATE INDEX "Invoice_recurringInvoiceId_idx" ON "Invoice"("recurringInvoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSent" ADD CONSTRAINT "ReminderSent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSent" ADD CONSTRAINT "ReminderSent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ReminderRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSent" ADD CONSTRAINT "ReminderSent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
