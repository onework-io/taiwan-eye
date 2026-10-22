// Taiwan cell towers at GET /api/taiwan-cell-towers: ~84k tower positions from
// the community map loxyz-tw/cell_tower_tw (2016 snapshot, fetched from its
// GitHub Pages site, not redistributed here) plus NCC's current 4G/5G licence
// counts. Both are keyless; each part fails on its own and keeps its last good
// value for a day.
import {
  parseTowerScript,
  summarizeNccStats,
} from '../../src/layers/taiwanCellTowers/records.js';
import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

export const TOWER_POSITIONS_URL =
  'https://loxyz-tw.github.io/cell_tower_tw/src/data.json';
export const NCC_STATS_URL = encodeURI(
  'https://api.ncc.gov.tw/uploaddowndoc?file=datagov/行動通信業務基地臺統計數(區分縣市業者).json' +
    '&filedisplay=行動通信業務基地臺統計數(區分縣市業者).json&flag=doc',
);
/** When the community snapshot was taken (its last data commit). */
export const TOWER_POSITIONS_AS_OF = '2016-05';

const MIB = 1024 * 1024;
const FRESH_MS = 24 * 60 * 60_000;
const STALE_LIMIT_MS = 7 * 24 * 60 * 60_000;
const TIMEOUT_MS = 30_000;

async function get(url, fetchImpl, accept) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetchImpl(url, {
    headers: { Accept: accept, 'User-Agent': 'gods-eye-view-taiwan/1.0' },
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${response.status}`);
  }
  return { response, signal };
}

async function readTextCapped(response, cap) {
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > cap) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Response too large');
  }
  const text = await response.text();
  if (text.length > cap) throw new Error('Response too large');
  return text;
}

export function taiwanCellTowersProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 20, globalMax: 300 });
  const parts = {
    points: { value: null, at: 0, error: null },
    stats: { value: null, at: 0, error: null },
  };
  let inFlight = null;

  const loaders = {
    points: async () => {
      const { response } = await get(
        TOWER_POSITIONS_URL,
        fetchImpl,
        'application/javascript, application/json, text/plain',
      );
      const points = parseTowerScript(await readTextCapped(response, 16 * MIB));
      if (!points.length) throw new Error('No tower positions');
      return points;
    },
    stats: async () => {
      const { response, signal } = await get(
        NCC_STATS_URL,
        fetchImpl,
        'application/json',
      );
      const summary = summarizeNccStats(
        await readResponseJsonCapped(response, 8 * MIB, signal),
      );
      if (!summary) throw new Error('Unrecognized NCC statistics');
      return summary;
    },
  };

  async function refresh() {
    await Promise.all(
      Object.entries(loaders).map(async ([key, load]) => {
        const part = parts[key];
        if (part.value && now() - part.at < FRESH_MS) return;
        try {
          part.value = await load();
          part.at = now();
          part.error = null;
        } catch (error) {
          part.error = String(error?.message || error);
          console.warn(`[TaiwanCellTowers] ${key} refresh failed:`, part.error);
          if (part.value && now() - part.at > STALE_LIMIT_MS) part.value = null;
        }
      }),
    );
  }

  async function snapshot() {
    if (!inFlight) inFlight = refresh().finally(() => (inFlight = null));
    await inFlight;
    return {
      fetchedAt: now(),
      points: parts.points.value || [],
      pointsAsOf: TOWER_POSITIONS_AS_OF,
      stats: parts.stats.value,
      errors: Object.entries(parts)
        .filter(([, part]) => part.error)
        .map(([key, part]) => `${key}: ${part.error}`),
    };
  }

  async function handler(req, res) {
    const json = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'private, max-age=3600',
      });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path !== '/' && path !== '')
      return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      const body = await snapshot();
      json(!body.points.length && !body.stats ? 502 : 200, body);
    } catch {
      json(502, { error: 'taiwan_cell_towers_unavailable' });
    }
  }

  return {
    name: 'taiwan-cell-towers',
    configureServer({ middlewares }) {
      middlewares.use('/api/taiwan-cell-towers', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/taiwan-cell-towers', handler);
    },
    // For tests.
    _snapshot: snapshot,
  };
}
