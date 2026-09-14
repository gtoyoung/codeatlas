import { getStore } from '@/lib/store.mjs';
import { apiError } from '@/lib/http';
import { listCommitHistory } from '@/modules/repository/history.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const store = await getStore();
    const repository = await store.getRepository(id);
    if (!repository) return Response.json({ error: { code: 'NOT_FOUND', message: '저장소를 찾지 못했습니다.' } }, { status: 404 });
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? '50');
    const query = url.searchParams.get('q') ?? '';
    const history = await listCommitHistory(repository.path, { limit, query });
    return Response.json({ repositoryId: id, ...history });
  } catch (error) {
    return apiError(error);
  }
}
