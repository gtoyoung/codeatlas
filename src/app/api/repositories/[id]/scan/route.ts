import { z } from 'zod';

import { getStore } from '@/lib/store.mjs';
import { apiError, rejectCrossOrigin } from '@/lib/http';
import { createLlmClient } from '@/modules/llm/client.mjs';
import { analyzeAndSaveRepository } from '@/modules/pipeline/analyze-repository.mjs';

export const runtime = 'nodejs';

const inputSchema = z.object({
  kind: z.enum(['commit', 'working_tree']).default('working_tree'),
  ref: z.string().min(1).max(200).default('HEAD'),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const { id } = await context.params;
    const input = inputSchema.parse(await request.json());
    const store = await getStore();
    const repository = await store.getRepository(id);
    if (!repository) return Response.json({ error: { code: 'NOT_FOUND', message: '저장소를 찾지 못했습니다.' } }, { status: 404 });
    const scan = await analyzeAndSaveRepository({
      store,
      llm: createLlmClient(),
      repository,
      kind: input.kind,
      ref: input.ref,
    });
    return Response.json({ scan }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
