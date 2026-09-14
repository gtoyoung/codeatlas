import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';

const migrationUrls = [
  new URL('../../../migrations/001_core.sql', import.meta.url),
  new URL('../../../migrations/002_pull_request.sql', import.meta.url),
];

function repositoryFrom(row) {
  return {
    id: row.id,
    name: row.name,
    path: row.local_path,
    defaultRef: row.default_ref,
    createdAt: row.created_at,
  };
}

function scanFrom(row) {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    kind: row.kind,
    targetOid: row.target_oid,
    baseOid: row.base_oid,
    manifestHash: row.manifest_hash,
    report: row.report,
    graph: row.graph,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

export async function createStore(dataDir = 'memory://') {
  if (!dataDir.includes('://')) {
    await mkdir(dirname(resolve(dataDir)), { recursive: true });
  }
  const db = await PGlite.create(dataDir);
  for (const migrationUrl of migrationUrls) {
    await db.exec(await readFile(fileURLToPath(migrationUrl), 'utf8'));
  }

  return {
    async addRepository({ name, path, defaultRef = 'HEAD' }) {
      const result = await db.query(
        `INSERT INTO repositories (id, name, local_path, default_ref)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (local_path) DO UPDATE
           SET name = EXCLUDED.name, default_ref = EXCLUDED.default_ref
         RETURNING *`,
        [randomUUID(), name, path, defaultRef],
      );
      return repositoryFrom(result.rows[0]);
    },

    async listRepositories() {
      const result = await db.query('SELECT * FROM repositories ORDER BY created_at DESC');
      return result.rows.map(repositoryFrom);
    },

    async getRepository(id) {
      const result = await db.query('SELECT * FROM repositories WHERE id = $1', [id]);
      return result.rows[0] ? repositoryFrom(result.rows[0]) : null;
    },

    async saveScan(input) {
      const id = randomUUID();
      const result = await db.query(
        `INSERT INTO scans
          (id, repository_id, kind, target_oid, base_oid, manifest_hash, report, graph, summary)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
         RETURNING *`,
        [
          id,
          input.repositoryId,
          input.kind,
          input.targetOid,
          input.baseOid,
          input.manifestHash,
          JSON.stringify(input.report),
          JSON.stringify(input.graph),
          JSON.stringify(input.summary),
        ],
      );
      return scanFrom(result.rows[0]);
    },

    async listScans(repositoryId) {
      const result = await db.query(
        'SELECT * FROM scans WHERE repository_id = $1 ORDER BY created_at DESC',
        [repositoryId],
      );
      return result.rows.map(scanFrom);
    },

    async getScan(id) {
      const result = await db.query('SELECT * FROM scans WHERE id = $1', [id]);
      return result.rows[0] ? scanFrom(result.rows[0]) : null;
    },

    async saveQuestion({ scanId, question, answer }) {
      const id = randomUUID();
      await db.query(
        'INSERT INTO questions (id, scan_id, question, answer) VALUES ($1, $2, $3, $4::jsonb)',
        [id, scanId, question, JSON.stringify(answer)],
      );
      return { id, scanId, question, answer };
    },

    async close() {
      await db.close();
    },
  };
}
