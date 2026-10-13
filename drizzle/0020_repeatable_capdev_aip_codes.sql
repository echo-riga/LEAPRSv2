ALTER TABLE "capdevs" DROP CONSTRAINT IF EXISTS "capdevs_aip_code_unique";
CREATE INDEX IF NOT EXISTS "capdevs_aip_code_idx" ON "capdevs" USING btree ("aip_code");
