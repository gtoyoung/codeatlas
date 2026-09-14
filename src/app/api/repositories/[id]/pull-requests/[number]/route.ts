import { getStore } from '@/lib/store.mjs';
import { apiError } from '@/lib/http';
import { createOneDevClient, oneDevConfigFromEnv, OneDevError } from '@/modules/integrations/onedev/client.mjs';
import { inspectPullRequestRefs } from '@/modules/integrations/onedev/refs.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function onedevError(error: unknown) {
  if (!(error instanceof OneDevError)) return null;
  const status = error.code === 'ONEDEV_NOT_CONFIGURED' ? 503
    : error.code === 'ONEDEV_UNAUTHORIZED' ? 401
      : error.code === 'ONEDEV_NOT_FOUND' ? 404 : 502;
  return Response.json({ error: { code: error.code, message: error.message } }, { status });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string; number: string }> }) {
  try {
    const { id, number } = await context.params;
    const store = await getStore();
    const repository = await store.getRepository(id);
    if (!repository) return Response.json({ error: { code: 'NOT_FOUND', message: '저장소를 찾지 못했습니다.' } }, { status: 404 });
    const client = createOneDevClient(oneDevConfigFromEnv());
    const [pullRequest, changes, reviews, comments, updates, builds, gitRefs] = await Promise.all([
      client.getPullRequest(number),
      client.getChanges(number),
      client.getReviews(number),
      client.getComments(number),
      client.getUpdates(number),
      client.getCurrentBuilds(number),
      inspectPullRequestRefs(repository.path, number),
    ]);
    return Response.json({ repositoryId: id, pullRequest, changes, reviews, comments, updates, builds, gitRefs });
  } catch (error) {
    return onedevError(error) ?? apiError(error);
  }
}
