import { getStore } from '@/lib/store.mjs';
import { apiError } from '@/lib/http';
import { createOneDevClient, oneDevConfigFromEnv, OneDevError } from '@/modules/integrations/onedev/client.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function onedevError(error: unknown) {
  if (!(error instanceof OneDevError)) return null;
  const status = error.code === 'ONEDEV_NOT_CONFIGURED' ? 503
    : error.code === 'ONEDEV_UNAUTHORIZED' ? 401
      : error.code === 'ONEDEV_NOT_FOUND' ? 404 : 502;
  return Response.json({ error: { code: error.code, message: error.message } }, { status });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const store = await getStore();
    const repository = await store.getRepository(id);
    if (!repository) return Response.json({ error: { code: 'NOT_FOUND', message: '저장소를 찾지 못했습니다.' } }, { status: 404 });
    const url = new URL(request.url);
    const client = createOneDevClient(oneDevConfigFromEnv());
    const result = await client.listPullRequests({
      query: url.searchParams.get('q') ?? '',
      offset: Number(url.searchParams.get('offset') ?? '0'),
      count: Number(url.searchParams.get('count') ?? '50'),
    });
    return Response.json({ repositoryId: id, configured: true, ...result });
  } catch (error) {
    return onedevError(error) ?? apiError(error);
  }
}
