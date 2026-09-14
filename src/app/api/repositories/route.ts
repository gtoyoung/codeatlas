import { basename, resolve } from 'node:path';
import { z } from 'zod';

import { getStore } from '@/lib/store.mjs';
import { apiError, rejectCrossOrigin } from '@/lib/http';
import { createLlmClient } from '@/modules/llm/client.mjs';
import { analyzeAndSaveRepository } from '@/modules/pipeline/analyze-repository.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  path: z.string().min(1).max(1024),
  name: z.string().min(1).max(100).optional(),
  defaultRef: z.string().min(1).max(200).default('HEAD'),
  kind: z.enum(['commit', 'working_tree']).default('working_tree'),
});

export async function GET() {
  const store = await getStore();
  const repositories = await store.listRepositories();
  const rows = await Promise.all(repositories.map(async (repository: any) => ({
    ...repository,
    latestScan: (await store.listScans(repository.id))[0] ?? null,
  })));
  return Response.json({ repositories: rows });
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const input = inputSchema.parse(await request.json());
    const path = resolve(input.path);
    const store = await getStore();
    const repository = await store.addRepository({
      name: input.name ?? basename(path),
      path,
      defaultRef: input.defaultRef,
    });
    const scan = await analyzeAndSaveRepository({
      store,
      llm: createLlmClient(),
      repository,
      kind: input.kind,
      ref: input.defaultRef,
    });
    return Response.json({ repository, scan }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
