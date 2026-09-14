import { resolve } from 'node:path';

import { createStore } from '../modules/store/database.mjs';

const globalKey = '__aiDevHandoffStorePromise';

export function getStore() {
  if (!globalThis[globalKey]) {
    const dataDir = resolve(/* turbopackIgnore: true */ process.env.AI_HANDOFF_DATA_DIR ?? '.data/postgres');
    globalThis[globalKey] = createStore(dataDir);
  }
  return globalThis[globalKey];
}
