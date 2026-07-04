-- UK market adjustments.
-- Note: drizzle-kit generated a full table-recreate here to change column
-- DEFAULTs, but D1 ignores `PRAGMA foreign_keys=OFF` inside migrations and
-- the recreate fails on FK constraints. The DEFAULT changes are not needed
-- at the DB level — signup and payment inserts set currency/timezone/VAT
-- explicitly — so this migration only adds the genuinely new column.
ALTER TABLE `tenants` ADD `vat_number` text;
