-- Project-level location so WhatsApp location replies can fall back to the project
-- when a unit has no location of its own, and so the CRM can manage it.
ALTER TABLE property_projects ADD COLUMN IF NOT EXISTS location_area VARCHAR(100);
ALTER TABLE property_projects ADD COLUMN IF NOT EXISTS location_city VARCHAR(100);
ALTER TABLE property_projects ADD COLUMN IF NOT EXISTS location_pincode VARCHAR(10);
ALTER TABLE property_projects ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8);
ALTER TABLE property_projects ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);
