// Taiwan water (水情): river levels, flood sensors and reservoirs, merged into
// one normalized snapshot at GET /api/taiwan-water. Every upstream is fixed and
// keyless; each part fails on its own, and a failed part keeps its last good
// value for up to an hour instead of blanking the layer.
import {
  joinRiverLevels,
  joinReservoirs,
  normalizeFloodDatastream,
} from '../../src/layers/taiwanWater/records.js';
import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

const WRA = 'https://opendata.wra.gov.tw/api/v2';
export const WRA_DATASETS = Object.freeze({
  riverStations: 'c4acc691-7416-40ca-9464-292c0c00da92', // 河川水位測站站況
  riverLevels: '73c4c3de-4045-4765-abeb-89f9f9cd5ff0', // 即時水位資料
  reservoirConditions: '2be9044c-6e44-4856-aad5-dd108c2e6679', // 水庫水情資料
  reservoirDaily: '51023e88-4c76-4dbc-bbb9-470da690d539', // 水庫每日營運狀況
});
export const FLOOD_STA_URL =
  'https://sta.colife.org.tw/STA_WaterResource_v2/v1.0/Datastreams?' +
  [
    '$count=true',
    '$top=1000',
    '$select=name,description,unitOfMeasurement',
    '$expand=Thing($select=name,properties),Thing/Locations($select=location),' +
      'Observations($orderby=phenomenonTime desc;$top=1;$select=phenomenonTime,result)',
    "$filter=Thing/properties/authority_type eq '水利署' and substringof('淹水深度',description)",
  ]
    .map((part) => {
      const [k, ...v] = part.split('=');
      return `${k}=${encodeURIComponent(v.join('='))}`;
    })
    .join('&');
const STA_ORIGIN = 'https://sta.colife.org.tw';

const MIB = 1024 * 1024;
const PAGE_SIZE = 1000;
const MAX_PAGES = 12;
const FRESH_MS = 5 * 60_000; // levels update every 10 minutes
const STALE_LIMIT_MS = 60 * 60_000;
const STATIONS_TTL_MS = 24 * 60 * 60_000; // station positions rarely change
const TIMEOUT_MS = 20_000;

async function getJson(url, fetchImpl, cap = 16 * MIB) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'gods-eye-view-taiwan-water/1.0',
    },
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${response.status}`);
  }
  return readResponseJsonCapped(response, cap, signal);
}

/** All pages of one WRA dataset (page/size paging, stops on a short page). */
export async function fetchWraDataset(id, fetchImpl) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await getJson(
      `${WRA}/${id}?page=${page}&size=${PAGE_SIZE}`,
      fetchImpl,
    );
    if (!Array.isArray(batch)) throw new Error('Malformed WRA response');
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

/** Every flood-depth Datastream, following @iot.nextLink on the same host. */
export async function fetchFloodSensors(fetchImpl) {
  const out = [];
  let url = FLOOD_STA_URL;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const payload = await getJson(url, fetchImpl, 32 * MIB);
    for (const stream of payload?.value || []) {
      const record = normalizeFloodDatastream(stream);
      if (record) out.push(record);
    }
    const next = payload?.['@iot.nextLink'];
    url =
      typeof next === 'string' && next.startsWith(`${STA_ORIGIN}/`) ? next : '';
  }
  const unique = new Map(out.map((r) => [r.id, r]));
  return [...unique.values()];
}

export function taiwanWaterProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 600 });
  const parts = {
    rivers: { value: null, at: 0, error: null },
    floods: { value: null, at: 0, error: null },
    reservoirs: { value: null, at: 0, error: null },
  };
  let stationRows = { value: null, at: 0 };
  let inFlight = null;

  async function riverStations() {
    if (stationRows.value && now() - stationRows.at < STATIONS_TTL_MS)
      return stationRows.value;
    const rows = await fetchWraDataset(WRA_DATASETS.riverStations, fetchImpl);
    stationRows = { value: rows, at: now() };
    return rows;
  }

  const loaders = {
    rivers: async () =>
      joinRiverLevels(
        await riverStations(),
        await fetchWraDataset(WRA_DATASETS.riverLevels, fetchImpl),
      ),
    floods: () => fetchFloodSensors(fetchImpl),
    reservoirs: async () => {
      const [daily, conditions] = await Promise.all([
        fetchWraDataset(WRA_DATASETS.reservoirDaily, fetchImpl),
        fetchWraDataset(WRA_DATASETS.reservoirConditions, fetchImpl),
      ]);
      return joinReservoirs(daily, conditions);
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
          console.warn(`[TaiwanWater] ${key} refresh failed:`, part.error);
          if (part.value && now() - part.at > STALE_LIMIT_MS) part.value = null;
        }
      }),
    );
  }

  async function snapshot() {
    if (!inFlight) inFlight = refresh().finally(() => (inFlight = null));
    await inFlight;
    const errors = Object.entries(parts)
      .filter(([, part]) => part.error)
      .map(([key, part]) => `${key}: ${part.error}`);
    return {
      fetchedAt: now(),
      rivers: parts.rivers.value || [],
      floods: parts.floods.value || [],
      reservoirs: parts.reservoirs.value || [],
      errors,
    };
  }

  async function handler(req, res) {
    const json = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
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
      const empty =
        !body.rivers.length && !body.floods.length && !body.reservoirs.length;
      json(empty && body.errors.length ? 502 : 200, body);
    } catch {
      json(502, { error: 'taiwan_water_unavailable' });
    }
  }

  return {
    name: 'taiwan-water',
    configureServer({ middlewares }) {
      middlewares.use('/api/taiwan-water', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/taiwan-water', handler);
    },
    // For tests.
    _snapshot: snapshot,
  };
}
