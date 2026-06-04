-- Property projects: group properties and imports per development/site

CREATE TABLE IF NOT EXISTS property_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_projects_company_sort_idx ON property_projects (company_id, sort_order);

CREATE TABLE IF NOT EXISTS property_project_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES property_projects(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NULL,
  storage_key VARCHAR(500) NOT NULL,
  file_size INTEGER NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_project_files_project_idx ON property_project_files (project_id);
CREATE INDEX IF NOT EXISTS property_project_files_company_idx ON property_project_files (company_id);

ALTER TABLE properties ADD COLUMN IF NOT EXISTS project_id UUID NULL REFERENCES property_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS properties_company_project_idx ON properties (company_id, project_id);

ALTER TABLE property_import_drafts ADD COLUMN IF NOT EXISTS project_id UUID NULL REFERENCES property_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS property_import_drafts_project_idx ON property_import_drafts (project_id);
