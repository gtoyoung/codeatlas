import { z } from 'zod';

import { getStore } from '@/lib/store.mjs';
import { apiError, rejectCrossOrigin } from '@/lib/http';
import { createLlmClient } from '@/modules/llm/client.mjs';
import { createOneDevClient, oneDevConfigFromEnv, OneDevError } from '@/modules/integrations/onedev/client.mjs';
import { ensurePullRequestRefs, inspectPullRequestRefs } from '@/modules/integrations/onedev/refs.mjs';
import { loadRangeSnapshot } from '@/modules/snapshot/range-sources.mjs';
import { analyzeAndSaveRepository } from '@/modules/pipeline/analyze-repository.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.object({}).default({});

function onedevError(error: unknown) {
  if (!(error instanceof OneDevError)) return null;
  const status = error.code === 'ONEDEV_NOT_CONFIGURED' ? 503
    : error.code === 'ONEDEV_UNAUTHORIZED' ? 401
      : error.code === 'ONEDEV_NOT_FOUND' ? 404 : 502;
  return Response.json({ error: { code: error.code, message: error.message } }, { status });
}

function scanError(error: unknown) {
  if (!(error instanceof Error)) return null;
  const code = (error as any).code;
  if (code === 'PR_OBJECTS_MISSING' || code === 'PR_REMOTE_MISSING' || code === 'PR_CACHE_INIT_FAILED' || error.message === 'PR_OBJECTS_MISSING') {
    return Response.json({
      error: {
        code: code === 'PR_REMOTE_MISSING' ? 'PR_REMOTE_MISSING' : 'PR_OBJECTS_MISSING',
        message: code === 'PR_REMOTE_MISSING'
          ? '원본 저장소에 origin remote가 없어 PR ref를 가져올 수 없습니다.'
          : 'PR의 base/head Git 객체가 로컬 저장소와 앱 캐시에 없습니다. origin 권한과 PR ref를 확인한 뒤 다시 분석하세요.',
        retryable: false,
      },
    }, { status: 409 });
  }
  return null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string; number: string }> }) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const { id, number } = await context.params;
    await inputSchema.parse(await request.json().catch(() => ({})));
    if (!/^\d+$/.test(number) || Number(number) < 1) {
      return Response.json({ error: { code: 'INVALID_INPUT', message: 'PR 번호가 올바르지 않습니다.' } }, { status: 400 });
    }
    const store = await getStore();
    const repository = await store.getRepository(id);
    if (!repository) return Response.json({ error: { code: 'NOT_FOUND', message: '저장소를 찾지 못했습니다.' } }, { status: 404 });
    const client = createOneDevClient(oneDevConfigFromEnv());
    const pullRequest = await client.getPullRequest(number);
    const prNumber = pullRequest.number ?? number;
    const [comments, reviews, updates, changes] = await Promise.all([
      client.getComments(number),
      client.getReviews(number),
      client.getUpdates(number),
      client.getChanges(number),
    ]);
    const localRefs = await inspectPullRequestRefs(repository.path, prNumber);
    let sourceRepo = repository.path;
    let gitRefs = localRefs;
    if (!localRefs.base.available || !localRefs.head.available) {
      try {
        const ensured = await ensurePullRequestRefs(repository.path, prNumber, {
          cacheRoot: process.env.AI_HANDOFF_GIT_CACHE_DIR ?? '.data/git-cache',
        });
        sourceRepo = ensured.repoPath;
        gitRefs = ensured.refs;
      } catch (error) {
        // Some Git servers expose commit hashes through the REST response but
        // do not advertise refs. If those objects are already local, use them.
        const baseHash = pullRequest.baseCommitHash;
        const headHash = pullRequest.headCommitHash ?? pullRequest.buildCommitHash;
        if (!baseHash || !headHash) throw error;
      }
    }
    const baseOid = gitRefs.base.oid ?? pullRequest.baseCommitHash;
    const headOid = gitRefs.head.oid ?? pullRequest.headCommitHash ?? pullRequest.buildCommitHash;
    const snapshot = await loadRangeSnapshot(sourceRepo, {
      baseRef: gitRefs.base.available ? gitRefs.base.ref : null,
      headRef: gitRefs.head.available ? gitRefs.head.ref : null,
      baseOid,
      headOid,
      metadata: {
        type: 'pull_request',
        number: pullRequest.number ?? Number(prNumber),
        id: pullRequest.id,
        title: pullRequest.title,
        description: pullRequest.description,
        status: pullRequest.status,
        source: pullRequest.source,
        target: pullRequest.target,
        author: pullRequest.author,
        comments: comments.slice(0, 80),
        reviews: reviews.slice(0, 80),
        updates: updates.slice(0, 80),
        changes: changes.slice(0, 80),
      } as any,
    });
    const scan = await analyzeAndSaveRepository({
      store,
      llm: createLlmClient(),
      repository,
      kind: 'pull_request',
      snapshot: snapshot as any,
    });
    return Response.json({ scan, pullRequest, gitRefs }, { status: 201 });
  } catch (error) {
    return onedevError(error) ?? scanError(error) ?? apiError(error);
  }
}
