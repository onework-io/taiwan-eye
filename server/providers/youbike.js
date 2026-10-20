// YouBike (Taiwan) → GBFS adapter.
//
// YouBike publishes one flat JSON array of stations per city instead of GBFS.
// The bikeshare layer only speaks GBFS, so the registry points it at a
// virtual host (YOUBIKE_VIRTUAL_HOST) and the GBFS proxy hands those requests
// here: one upstream fetch, reshaped into GBFS 2.3 station_information or
// station_status. The upstream is fixed per city, so the virtual host cannot
// be used to reach anything else.
import { readResponseTextCapped } from './common/http.js';

/** Reserved-TLD host that never resolves; only this adapter answers it. */
export const YOUBIKE_VIRTUAL_HOST = 'youbike.gbfs.invalid';

/** City feeds: virtual path segment → upstream JSON (keyless open data). */
export const YOUBIKE_FEEDS = Object.freeze({
  taipei:
    'https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json',
});

const UPSTREAM_TIMEOUT_MS = 12000;
const MAX_BYTES = 8 * 1024 * 1024;
const CACHE_MS = 55_000;
const cache = new Map(); // city → { at, rows }

const num = (value) => {
  if (value == null || value === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};
const first = (row, keys) => {
  for (const key of keys)
    if (row?.[key] != null && row[key] !== '') return row[key];
  return undefined;
};

/** "2026-10-20 07:51:52" (Asia/Taipei) → epoch seconds. */
export function taipeiTimeToEpoch(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
    String(text || ''),
  );
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Math.floor(Date.UTC(y, mo - 1, d, h - 8, mi, s) / 1000);
}

/** Drop the "YouBike2.0_" prefix every station name carries. */
const stationName = (name) =>
  String(name || '')
    .replace(/^YouBike\s*2\.0_/i, '')
    .trim();

/**
 * One YouBike row → the GBFS fields this app reads. Tolerates the field
 * spellings the different city feeds use (latitude/lat, Quantity/tot, …).
 */
export function normalizeYoubikeRow(row) {
  const lat = num(first(row, ['latitude', 'lat']));
  const lon = num(first(row, ['longitude', 'lng', 'lon']));
  const id = String(first(row, ['sno', 'station_no']) ?? '').trim();
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const capacity = num(first(row, ['Quantity', 'total', 'tot']));
  const bikes = num(first(row, ['available_rent_bikes', 'sbi']));
  const docks = num(first(row, ['available_return_bikes', 'bemp']));
  return {
    station_id: id,
    name: stationName(first(row, ['sna', 'name'])),
    name_en: stationName(first(row, ['snaen'])),
    address: String(first(row, ['ar']) ?? ''),
    district: String(first(row, ['sarea']) ?? ''),
    lat,
    lon,
    capacity: Number.isFinite(capacity) ? capacity : undefined,
    bikes: Number.isFinite(bikes) ? bikes : 0,
    docks: Number.isFinite(docks) ? docks : 0,
    active: String(first(row, ['act']) ?? '1') === '1',
    reported: taipeiTimeToEpoch(
      first(row, ['srcUpdateTime', 'mday', 'updateTime']),
    ),
  };
}

/** Station rows → a GBFS 2.3 document of the requested kind. */
export function youbikeToGbfs(rows, kind, now = Date.now()) {
  const stations = (Array.isArray(rows) ? rows : [])
    .map(normalizeYoubikeRow)
    .filter(Boolean);
  const lastUpdated = Math.floor(now / 1000);
  const data =
    kind === 'station_information'
      ? stations.map((s) => ({
          station_id: s.station_id,
          name: s.name,
          lat: s.lat,
          lon: s.lon,
          address: s.address || undefined,
          capacity: s.capacity,
        }))
      : stations.map((s) => ({
          station_id: s.station_id,
          num_bikes_available: s.bikes,
          num_docks_available: s.docks,
          is_installed: true,
          is_renting: s.active,
          is_returning: s.active,
          last_reported: Number.isFinite(s.reported) ? s.reported : lastUpdated,
        }));
  return {
    last_updated: lastUpdated,
    ttl: 60,
    version: '2.3',
    data: { stations: data },
  };
}

/**
 * Parse a virtual-host request path: /<city>/station_information.json.
 * @returns {{city: string, kind: string}|null}
 */
export function parseYoubikePath(pathname) {
  const m = /^\/([a-z]+)\/(station_information|station_status)(\.json)?$/i.exec(
    String(pathname || ''),
  );
  if (!m) return null;
  const city = m[1].toLowerCase();
  if (!Object.hasOwn(YOUBIKE_FEEDS, city)) return null;
  return { city, kind: m[2].toLowerCase() };
}

async function loadRows(city, fetchImpl) {
  const hit = cache.get(city);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetchImpl(YOUBIKE_FEEDS[city], {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gods-eye-view-youbike/1.0',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`YouBike upstream HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const text = await readResponseTextCapped(
      res,
      MAX_BYTES,
      controller.signal,
    );
    const parsed = JSON.parse(text.replace(/^﻿/, ''));
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed?.retVal || parsed?.data || [];
    cache.set(city, { at: Date.now(), rows });
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Answer one virtual-host GBFS request.
 * @returns {Promise<{status:number, contentType:string, body:string}>}
 */
export async function fetchYoubikeGbfs(pathname, { fetchImpl = fetch } = {}) {
  const parsed = parseYoubikePath(pathname);
  if (!parsed) {
    return {
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unknown YouBike feed' }),
    };
  }
  const rows = await loadRows(parsed.city, fetchImpl);
  return {
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(youbikeToGbfs(rows, parsed.kind)),
  };
}
