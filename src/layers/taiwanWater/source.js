import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { readWaterSnapshot } from './records.js';

// No i18n here: failures stay English data; the Layers panel translates them.
const msg = (text) => text;

/** Request the merged Taiwan water snapshot from the same-origin provider. */
export function createTaiwanWaterSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/taiwan-water', { signal });
      if (!response.ok) throw new Error(`Taiwan water HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(
        response,
        24 * 1024 * 1024,
        signal,
      );
      signal?.throwIfAborted();
      if (!payload || typeof payload !== 'object')
        throw new Error(msg('Malformed Taiwan water snapshot'));
      return readWaterSnapshot(payload);
    },
  };
}
