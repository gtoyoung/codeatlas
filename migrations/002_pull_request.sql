-- Existing development databases may have been created with the v0.2 check.
ALTER TABLE scans DROP CONSTRAINT IF EXISTS scans_kind_check;
ALTER TABLE scans ADD CONSTRAINT scans_kind_check CHECK (kind IN ('commit', 'working_tree', 'pull_request'));
