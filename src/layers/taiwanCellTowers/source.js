import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { readCellSnapshot } from './records.js';

// No i18n here: failures stay English data; the Layers panel translates them.
const msg = (text) => text;

/** Request tower positions and NCC counts from the same-origin provider. */
export function createTaiwanCellTowersSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/taiwan-cell-towers', { signal });
      if (!response.ok)
        throw new Error(`Taiwan cell towers HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(
        response,
        24 * 1024 * 1024,
        signal,
      );
      signal?.throwIfAborted();
      if (!payload || typeof payload !== 'object')
        throw new Error(msg('Malformed Taiwan cell tower snapshot'));
      return readCellSnapshot(payload);
    },
  };
}
