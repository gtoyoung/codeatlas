const decoder = new TextDecoder('utf-8', { fatal: true });

function decode(raw) {
  try {
    return decoder.decode(raw);
  } catch {
    throw new Error('PATH_ENCODING_UNSUPPORTED');
  }
}

export function parseTree(raw) {
  const input = decode(raw);
  if (input.length === 0) return [];

  return input.split('\0').filter(Boolean).map((record) => {
    const tab = record.indexOf('\t');
    if (tab < 0) throw new Error('INVALID_TREE_RECORD');

    const metadata = record.slice(0, tab).split(' ');
    if (metadata.length !== 3 || metadata.some((value) => !value)) {
      throw new Error('INVALID_TREE_RECORD');
    }

    const [mode, objectType, oid] = metadata;
    return { mode, objectType, oid, path: record.slice(tab + 1) };
  });
}

export function parseChanges(raw) {
  const input = decode(raw);
  if (input.length === 0) return [];

  const tokens = input.split('\0');
  if (tokens.at(-1) === '') tokens.pop();

  const changes = [];
  let cursor = 0;

  while (cursor < tokens.length) {
    const header = tokens[cursor++];
    if (!header.startsWith(':')) throw new Error('INVALID_DIFF_RECORD');

    const fields = header.slice(1).split(' ');
    if (fields.length !== 5 || fields.some((value) => !value)) {
      throw new Error('INVALID_DIFF_RECORD');
    }

    const [oldMode, newMode, oldOidValue, newOidValue, status] = fields;
    if (!/^[A-Z](?:\d+)?$/.test(status)) throw new Error('INVALID_DIFF_RECORD');

    const pathCount = status[0] === 'R' || status[0] === 'C' ? 2 : 1;
    const paths = tokens.slice(cursor, cursor + pathCount);
    if (paths.length !== pathCount || paths.some((path) => !path)) {
      throw new Error('INVALID_DIFF_RECORD');
    }
    cursor += pathCount;

    const oldPath = status[0] === 'A' ? null : paths[0];
    const newPath = status[0] === 'D' ? null : paths[pathCount - 1];

    changes.push({
      status,
      oldMode,
      newMode,
      oldOid: status[0] === 'A' ? null : oldOidValue,
      newOid: status[0] === 'D' ? null : newOidValue,
      oldPath,
      newPath,
    });
  }

  return changes;
}
