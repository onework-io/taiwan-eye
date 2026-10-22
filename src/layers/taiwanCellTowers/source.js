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

    /** County and district for one point (OpenStreetMap, via the provider). */
    async whereIs(lat, lon, { signal } = {}) {
      const params = new URLSearchParams({
        lat: lat.toFixed(5),
        lon: lon.toFixed(5),
      });
      const response = await fetchImpl(
        `/api/taiwan-cell-towers/where?${params}`,
        { signal },
      );
      if (!response.ok) throw new Error(`Place lookup HTTP ${response.status}`);
      const body = await readResponseJsonCapped(response, 64 * 1024, signal);
      const text = (value) => String(value || '').slice(0, 80);
      return { county: text(body?.county), district: text(body?.district) };
    },
  };
}
