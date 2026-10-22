// Taiwan cell towers: parsing shared by the server provider and the browser.
//
// Positions: the community map loxyz-tw/cell_tower_tw ships one script,
// `var data = { "icons": [ { "longitude": …, "latitude": … }, … ] }`, about
// 84,000 sites scraped in 2016 (positions only — no operator or technology).
// Current numbers: NCC open data 22592, 4G/5G licences per county and operator.

/** Taiwan and its outlying islands, generously. */
const BOUNDS = { west: 117.0, east: 123.0, south: 21.0, north: 27.0 };

/** Whether a point is in Taiwan or its outlying islands. */
export const isTaiwanPoint = (lon, lat) =>
  Number.isFinite(lon) &&
  Number.isFinite(lat) &&
  lon >= BOUNDS.west &&
  lon <= BOUNDS.east &&
  lat >= BOUNDS.south &&
  lat <= BOUNDS.north;

/**
 * Parse the community tower script into a flat [lon, lat, lon, lat, …] array,
 * rounded to ~1 m and de-duplicated.
 * @param {string} text
 * @returns {number[]}
 */
export function parseTowerScript(text) {
  const source = String(text || '');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Malformed tower data');
  const payload = JSON.parse(source.slice(start, end + 1));
  const icons = Array.isArray(payload?.icons) ? payload.icons : [];
  const seen = new Set();
  const flat = [];
  for (const icon of icons) {
    const lon = Math.round(Number(icon?.longitude) * 1e5) / 1e5;
    const lat = Math.round(Number(icon?.latitude) * 1e5) / 1e5;
    if (!isTaiwanPoint(lon, lat)) continue;
    const key = `${lon},${lat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flat.push(lon, lat);
  }
  return flat;
}

/** One spelling for county names: NCC and OSM disagree on 台/臺. */
export function normalizeCounty(name) {
  return String(name || '')
    .trim()
    .replace(/台/g, '臺');
}

/**
 * Neighbourhood of one site, by brute force over the flat array (84k points
 * is a millisecond). Distances use an equirectangular approximation, which is
 * far inside a metre at these ranges.
 * @returns {{within: number, nearestM: number|null}}
 */
export function towerNeighborhood(points, index, radiusM = 500) {
  const lon0 = points[index * 2];
  const lat0 = points[index * 2 + 1];
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const dLatMax = radiusM / mPerDegLat;
  let within = 0;
  let nearest = Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    if (i === index * 2) continue;
    const dy = (points[i + 1] - lat0) * mPerDegLat;
    const dx = (points[i] - lon0) * mPerDegLon;
    const d2 = dx * dx + dy * dy;
    if (d2 < nearest) nearest = d2;
    if (Math.abs(points[i + 1] - lat0) <= dLatMax && d2 <= radiusM * radiusM)
      within += 1;
  }
  return {
    within,
    nearestM: Number.isFinite(nearest) ? Math.sqrt(nearest) : null,
  };
}

const numberOf = (value) => {
  const n = Number(String(value ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** A sortable number for an NCC period such as "115年9月", "11509" or "2026/09". */
export function periodRank(period) {
  const digits = String(period ?? '').match(/\d+/g) || [];
  if (!digits.length) return -1;
  if (digits.length === 1) {
    const d = digits[0];
    if (d.length >= 5)
      return Number(d.slice(0, -2)) * 100 + Number(d.slice(-2));
    return Number(d) * 100;
  }
  let year = Number(digits[0]);
  if (year < 1000) year += 1911; // ROC year
  return year * 100 + Number(digits[1]);
}

const field = (row, ...names) => {
  for (const name of names) {
    if (row?.[name] != null && row[name] !== '') return row[name];
  }
  // Tolerate stray whitespace or BOMs in header names.
  const keys = Object.keys(row || {});
  for (const name of names) {
    const key = keys.find((k) => k.replace(/[\s﻿]/g, '') === name);
    if (key && row[key] != null && row[key] !== '') return row[key];
  }
  return null;
};

/** The rows of an NCC JSON download, whichever wrapper it arrives in. */
function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const value of Object.values(payload)) {
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

/**
 * Summarize NCC 4G/5G licence counts for the latest period.
 * @returns {null|{period: string, total: number, byTech: object, byOperator: object, byCounty: object}}
 */
export function summarizeNccStats(payload) {
  const rows = rowsOf(payload)
    .map((row) => ({
      county: String(field(row, '縣市') ?? '').trim(),
      period: String(field(row, '統計期') ?? '').trim(),
      operator: String(field(row, '業者名稱', '業者') ?? '').trim(),
      tech: String(field(row, '類別') ?? '').trim(),
      count: numberOf(field(row, '基地臺', '基地台', '基地臺數')),
    }))
    .filter((row) => row.period && row.count != null);
  if (!rows.length) return null;
  const latest = rows.reduce((best, row) =>
    periodRank(row.period) > periodRank(best.period) ? row : best,
  ).period;
  const byTech = {};
  const byOperator = {};
  const byCounty = {};
  let total = 0;
  for (const row of rows) {
    if (row.period !== latest) continue;
    // Skip roll-up rows so nothing is counted twice.
    if (
      /^(總計|合計|小計)$/.test(row.county) ||
      /^(總計|合計|小計)$/.test(row.operator)
    )
      continue;
    const tech = /5G/i.test(row.tech)
      ? '5G'
      : /4G/i.test(row.tech)
        ? '4G'
        : row.tech || '—';
    byTech[tech] = (byTech[tech] || 0) + row.count;
    if (row.operator)
      byOperator[row.operator] = (byOperator[row.operator] || 0) + row.count;
    if (row.county) {
      const county = normalizeCounty(row.county);
      const entry = (byCounty[county] ||= {
        total: 0,
        byTech: {},
        byOperator: {},
      });
      entry.total += row.count;
      entry.byTech[tech] = (entry.byTech[tech] || 0) + row.count;
      if (row.operator)
        entry.byOperator[row.operator] =
          (entry.byOperator[row.operator] || 0) + row.count;
    }
    total += row.count;
  }
  return { period: latest, total, byTech, byOperator, byCounty };
}

/** Validate the provider payload in the browser. */
export function readCellSnapshot(payload) {
  const raw = Array.isArray(payload?.points) ? payload.points : [];
  const points = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const lon = Number(raw[i]);
    const lat = Number(raw[i + 1]);
    if (isTaiwanPoint(lon, lat)) points.push(lon, lat);
  }
  const stats =
    payload?.stats && typeof payload.stats === 'object' ? payload.stats : null;
  return {
    points,
    pointsAsOf:
      typeof payload?.pointsAsOf === 'string' ? payload.pointsAsOf : null,
    stats,
    fetchedAt: Number(payload?.fetchedAt) || null,
    errors: Array.isArray(payload?.errors) ? payload.errors.map(String) : [],
  };
}
