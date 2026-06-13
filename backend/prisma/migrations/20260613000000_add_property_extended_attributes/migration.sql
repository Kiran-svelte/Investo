-- Add JSON column for CSV/spreadsheet fields beyond dedicated Property columns.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS extended_attributes JSONB NOT NULL DEFAULT '{}'::jsonb;
