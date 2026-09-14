import { getStore } from '@/lib/store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const store = await getStore();
  const scan = await store.getScan(id);
  if (!scan) return Response.json({ error: { code: 'NOT_FOUND', message: '분석 결과를 찾지 못했습니다.' } }, { status: 404 });
  return Response.json({ scan });
}
