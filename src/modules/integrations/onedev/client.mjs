const DEFAULT_COUNT = 50;

export class OneDevError extends Error {
  constructor(code, message, { status = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'OneDevError';
    this.code = code;
    this.status = status;
  }
}

function person(value) {
  if (!value) return { name: '알 수 없음', email: null };
  if (typeof value === 'string') return { name: value, email: null };
  return {
    name: value.name ?? value.displayName ?? value.fullName ?? value.userName ?? '알 수 없음',
    email: value.email ?? null,
  };
}

function projectPath(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.path ?? value.name ?? value.key ?? null;
}

function pullRequest(value) {
  return {
    id: value.id ?? null,
    number: value.number ?? value.requestNumber ?? null,
    title: value.title ?? '(제목 없음)',
    description: value.description ?? '',
    status: String(value.status ?? 'UNKNOWN').toLowerCase(),
    source: value.source ?? value.sourceBranch ?? value.headBranch ?? null,
    target: value.target ?? value.targetBranch ?? value.baseBranch ?? null,
    sourceProject: projectPath(value.sourceProject ?? value.sourceProjectPath),
    targetProject: projectPath(value.targetProject ?? value.targetProjectPath),
    baseCommitHash: value.baseCommitHash ?? value.baseOid ?? value.targetCommitHash ?? null,
    headCommitHash: value.headCommitHash ?? value.sourceCommitHash ?? value.headOid ?? value.buildCommitHash ?? null,
    buildCommitHash: value.buildCommitHash ?? null,
    author: person(value.submitter ?? value.author ?? value.creator),
    createdAt: value.submitDate ?? value.createdAt ?? null,
    updatedAt: value.lastUpdated ?? value.updatedAt ?? null,
    project: value.project?.path ?? value.projectPath ?? null,
    raw: value,
  };
}

function unwrapList(body) {
  if (Array.isArray(body)) return body;
  return body?.content ?? body?.items ?? body?.pullRequests ?? body?.changes
    ?? body?.reviews ?? body?.comments ?? body?.updates ?? body?.builds ?? body?.data ?? [];
}

export function createOneDevClient({ serverUrl, accessToken, projectPath = '', fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = String(serverUrl ?? '').trim().replace(/\/+$/, '');
  const token = String(accessToken ?? '').trim();
  if (!fetchImpl) throw new OneDevError('ONEDEV_FETCH_UNAVAILABLE', '서버에서 fetch를 사용할 수 없습니다.');

  async function request(path, params = {}) {
    if (!baseUrl || !token) throw new OneDevError('ONEDEV_NOT_CONFIGURED', 'ONEDEV_NOT_CONFIGURED: 서버 URL과 액세스 토큰을 설정하세요.');
    let url;
    try {
      url = new URL(`${baseUrl}${path}`);
    } catch (cause) {
      throw new OneDevError('ONEDEV_INVALID_URL', 'OneDev 서버 URL이 올바르지 않습니다.', { cause });
    }
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (cause) {
      throw new OneDevError('ONEDEV_NETWORK', 'OneDev에 연결하지 못했습니다.', { cause });
    }
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403
        ? 'ONEDEV_UNAUTHORIZED'
        : response.status === 404 ? 'ONEDEV_NOT_FOUND' : 'ONEDEV_REQUEST_FAILED';
      throw new OneDevError(code, body?.message ?? `OneDev 요청이 실패했습니다 (${response.status}).`, { status: response.status });
    }
    return body;
  }

  return {
    async listPullRequests({ query = '', offset = 0, count = DEFAULT_COUNT } = {}) {
      const body = await request('/~api/pulls', {
        query,
        offset: Math.max(0, Number(offset) || 0),
        count: Math.max(1, Math.min(Number(count) || DEFAULT_COUNT, 100)),
        projectPath,
      });
      const items = unwrapList(body).map(pullRequest);
      return {
        items,
        offset: Number(body?.offset ?? offset) || 0,
        count: Number(body?.count ?? items.length) || items.length,
        hasMore: Boolean(body?.hasMore ?? body?.has_more ?? items.length >= count),
      };
    },
    async getPullRequest(id) {
      return pullRequest(await request(`/~api/pulls/${encodeURIComponent(id)}`));
    },
    async getChanges(id) {
      return unwrapList(await request(`/~api/pulls/${encodeURIComponent(id)}/changes`));
    },
    async getReviews(id) {
      return unwrapList(await request(`/~api/pulls/${encodeURIComponent(id)}/reviews`));
    },
    async getComments(id) {
      return unwrapList(await request(`/~api/pulls/${encodeURIComponent(id)}/comments`));
    },
    async getUpdates(id) {
      return unwrapList(await request(`/~api/pulls/${encodeURIComponent(id)}/updates`));
    },
    async getCurrentBuilds(id) {
      return unwrapList(await request(`/~api/pulls/${encodeURIComponent(id)}/current-builds`));
    },
  };
}

export function oneDevConfigFromEnv(env = process.env) {
  return {
    serverUrl: env.ONEDEV_SERVER_URL ?? '',
    accessToken: env.ONEDEV_ACCESS_TOKEN ?? '',
    projectPath: env.ONEDEV_PROJECT_PATH ?? '',
  };
}
