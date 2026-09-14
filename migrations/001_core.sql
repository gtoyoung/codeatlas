CREATE TABLE IF NOT EXISTS repositories (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL UNIQUE,
  default_ref TEXT NOT NULL DEFAULT 'HEAD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scans (
  id UUID PRIMARY KEY,
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('commit', 'working_tree', 'pull_request')),
  target_oid TEXT,
  base_oid TEXT,
  manifest_hash TEXT NOT NULL,
  report JSONB NOT NULL,
  graph JSONB NOT NULL,
  summary JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scans_repository_created_idx
  ON scans(repository_id, created_at DESC);

CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY,
  scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
