import { z } from 'zod';

import { getStore } from '@/lib/store.mjs';
import { apiError, rejectCrossOrigin } from '@/lib/http';
import { createLlmClient } from '@/modules/llm/client.mjs';

export const runtime = 'nodejs';

const inputSchema = z.object({ question: z.string().min(2).max(1000) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const { id } = await context.params;
    const input = inputSchema.parse(await request.json());
    const store = await getStore();
    const scan = await store.getScan(id);
    if (!scan) return Response.json({ error: { code: 'NOT_FOUND', message: '분석 결과를 찾지 못했습니다.' } }, { status: 404 });
    const answer = await createLlmClient().answer({
      question: input.question,
      context: scan.report.metadata ?? scan.report.context ?? null,
      evidence: scan.report.evidence ?? [],
    });
    await store.saveQuestion({ scanId: id, question: input.question, answer });
    return Response.json({ answer });
  } catch (error) {
    return apiError(error);
  }
}
