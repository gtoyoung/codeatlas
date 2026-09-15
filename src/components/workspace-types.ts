export type ChangeDiff = {
  status: 'available' | 'binary' | 'unavailable';
  patch: string | null;
  additions: number;
  deletions: number;
  truncated?: boolean;
};

export type Narrative = {
  why: string;
  what: string;
  impact: string;
  confidence: string;
};

export type EvidenceRecord = {
  id: string;
  kind?: string;
  text: string;
  path?: string | null;
  range?: { path?: string | null; startLine?: number | null } | null;
  diff?: ChangeDiff | null;
};

export type AnswerSection = {
  key: string;
  label: string;
  text: string;
  citations: string[];
  items?: string[];
};

export type Answer = {
  answer: string;
  citations: string[];
  support: string;
  mode: string;
  sections?: AnswerSection[];
};

export type Scan = {
  id: string;
  kind: 'commit' | 'working_tree' | 'pull_request';
  targetOid: string | null;
  baseOid: string | null;
  createdAt: string;
  summary: { title: string; overview: string; mode: string; cautions?: string[]; relationCount?: number; narrative?: Narrative };
  report: {
    changes: Array<{ status: string; oldPath: string | null; newPath: string | null; diff?: ChangeDiff | null }>;
    files: Array<{ path: string; state?: string; reason?: string | null }>;
    metadata?: {
      type?: 'commit' | 'pull_request';
      id?: number | string | null;
      number?: number | null;
      title?: string;
      description?: string;
      subject?: string;
      body?: string;
      author?: { name?: string; email?: string };
      source?: string | null;
      target?: string | null;
      comments?: Array<unknown>;
      reviews?: Array<unknown>;
      updates?: Array<unknown>;
    } | null;
    coverage?: { totalFiles: number; indexedFiles: number; excludedFiles: number; partialFiles?: number };
    evidence?: EvidenceRecord[];
  };
  graph: {
    nodes: Array<{ id: string; kind: string; label: string; path?: string }>;
    edges: Array<{ id: string; source: string; target: string; kind: string; evidence?: { path: string; startLine: number } }>;
    coverage: { totalFiles: number; indexedFiles: number; partialFiles: number; excludedFiles: number; failedFiles: number; issues: Array<{ path: string; reason: string }> };
  };
};

export type Repository = {
  id: string;
  name: string;
  path: string;
  defaultRef: string;
  latestScan: Scan | null;
};

export type QuestionRecord = {
  id: string;
  scanId?: string;
  question: string;
  answer: Answer;
  createdAt: string;
};

export type TimelineEvent = {
  id: string;
  kind: 'snapshot' | 'narrative' | 'impact' | 'question' | 'answer';
  title: string;
  text?: string;
  metrics?: { files: number; additions: number; deletions: number };
  narrative?: Narrative;
  items?: Array<{ id: string; label: string; text: string; path?: string | null; line?: number | null; diff?: ChangeDiff | null }>;
  evidenceIds?: string[];
  question?: string;
  answer?: Answer;
  questionId?: string;
  createdAt?: string;
};
