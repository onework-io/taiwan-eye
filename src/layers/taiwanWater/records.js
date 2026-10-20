/**
 * Taiwan water (水情) records: pure normalizers shared by the server provider
 * (server/providers/taiwanWater.js) and the layer. No Cesium, no i18n.
 *
 * Sources (all keyless; Open Government Data License v1.0):
 * - 經濟部水利署 水利資料開放平台 (opendata.wra.gov.tw):
 *     河川水位測站站況 (station positions in TWD97 TM2, alert levels),
 *     即時水位資料 (10-minute levels), 水庫水情資料, 水庫每日營運狀況.
 * - 民生公共物聯網 SensorThings (sta.colife.org.tw): 水利署淹水感測器
 *   positions and their latest flood depth.
 */

// ---------------------------------------------------------------------------
// TWD97 TM2 (EPSG:3826, central meridian 121°E) → WGS84 longitude/latitude.
// TWD97 uses the GRS80 ellipsoid, which matches WGS84 to well under a metre.
// ---------------------------------------------------------------------------
const A = 6378137.0;
const F = 1 / 298.257222101;
const K0 = 0.9999;
const LON0 = (121 * Math.PI) / 180;
const FALSE_EASTING = 250000;

/**
 * @param {number} x TWD97 TM2 easting (m)
 * @param {number} y TWD97 TM2 northing (m)
 * @returns {{lat:number, lon:number}|null}
 */
export function twd97ToWgs84(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const e2 = 2 * F - F * F;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const ep2 = e2 / (1 - e2);
  const m = y / K0;
  const mu = m / (A * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const c1 = ep2 * cos1 * cos1;
  const t1 = tan1 * tan1;
  const n1 = A / Math.sqrt(1 - e2 * sin1 * sin1);
  const r1 = (A * (1 - e2)) / (1 - e2 * sin1 * sin1) ** 1.5;
  const d = (x - FALSE_EASTING) / (n1 * K0);
  const lat =
    phi1 -
    ((n1 * tan1) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) *
          d ** 6) /
          720);
  const lon =
    LON0 +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) /
        120) /
      cos1;
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** Taiwan, Penghu, Kinmen and Matsu. */
export function inTaiwanArea(lat, lon) {
  return lat >= 21.8 && lat <= 26.5 && lon >= 118 && lon <= 122.2;
}

const num = (value) => {
  if (value == null || value === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/** "2026-10-20T17:30:00" (Taiwan local, no zone) or with an offset → ms. */
export function taiwanTimeToMs(text) {
  const s = String(text || '').trim();
  if (!s) return NaN;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s);
  const ms = Date.parse(`${s.replace(' ', 'T')}+08:00`);
  return Number.isFinite(ms) ? ms : NaN;
}

// Labels stay English data here (shared with the server); the layer translates.
const msg = (text) => text;

// ---------------------------------------------------------------------------
// Status bands. Colours are shared with the layer legend.
// ---------------------------------------------------------------------------
export const WATER_STATUS = Object.freeze({
  normal: { key: 'normal', label: msg('Normal'), color: '#4FC3F7' },
  watch: { key: 'watch', label: msg('Alert level 3'), color: '#FFD54F' },
  warning: { key: 'warning', label: msg('Alert level 2'), color: '#FF9800' },
  danger: { key: 'danger', label: msg('Alert level 1'), color: '#F44336' },
  flooded: { key: 'flooded', label: msg('Flooding'), color: '#E040FB' },
  dry: { key: 'dry', label: msg('No flooding'), color: '#26A69A' },
  reservoir: { key: 'reservoir', label: msg('Reservoir'), color: '#29B6F6' },
  unknown: { key: 'unknown', label: msg('No reading'), color: '#90A4AE' },
});

/**
 * River level against the station's alert levels. WRA numbers them so that
 * level 1 is the most severe (一級警戒), level 3 the least.
 */
export function riverStatus(level, alerts = {}) {
  if (!Number.isFinite(level)) return WATER_STATUS.unknown;
  const { alert1, alert2, alert3 } = alerts;
  if (Number.isFinite(alert1) && level >= alert1) return WATER_STATUS.danger;
  if (Number.isFinite(alert2) && level >= alert2) return WATER_STATUS.warning;
  if (Number.isFinite(alert3) && level >= alert3) return WATER_STATUS.watch;
  return WATER_STATUS.normal;
}

/** Flood depth in cm: anything at or above this counts as flooding. */
export const FLOOD_DEPTH_THRESHOLD_CM = 1;

// ---------------------------------------------------------------------------
// River water level: join 站況 (positions) with 即時水位 (levels).
// ---------------------------------------------------------------------------

/** One 河川水位測站站況 row → station or null (decommissioned, unplaced). */
export function normalizeRiverStation(row) {
  const id = String(row?.basinidentifier || '').trim();
  if (!id) return null;
  if (/廢/.test(String(row?.observationstatus || ''))) return null;
  const [x, y] = String(row?.locationbytwd97_xy || '')
    .trim()
    .split(/\s+/)
    .map(Number);
  const point = twd97ToWgs84(x, y);
  if (!point || !inTaiwanArea(point.lat, point.lon)) return null;
  return {
    id,
    name: String(row?.observatoryname || id).trim(),
    river: String(row?.rivername || '').trim(),
    address: String(row?.locationaddress || '').trim(),
    lat: point.lat,
    lon: point.lon,
    alert1: num(row?.alertlevel1),
    alert2: num(row?.alertlevel2),
    alert3: num(row?.alertlevel3),
  };
}

/**
 * Join stations with their newest level.
 * @returns {Array<object>} river records
 */
export function joinRiverLevels(stationRows, levelRows) {
  const levels = new Map();
  for (const row of Array.isArray(levelRows) ? levelRows : []) {
    const id = String(row?.stationid || '').trim();
    const value = num(row?.waterlevel);
    const at = taiwanTimeToMs(row?.datetime);
    if (!id || !Number.isFinite(value)) continue;
    const prior = levels.get(id);
    if (!prior || at > prior.at) levels.set(id, { value, at });
  }
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(stationRows) ? stationRows : []) {
    const station = normalizeRiverStation(row);
    if (!station || seen.has(station.id)) continue;
    const reading = levels.get(station.id);
    if (!reading) continue; // only stations reporting now
    seen.add(station.id);
    const status = riverStatus(reading.value, station);
    out.push({
      kind: 'river',
      ...station,
      value: reading.value,
      unit: 'm',
      observedMs: reading.at,
      status: status.key,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Flood sensors (SensorThings Datastreams expanded with Thing, Locations and
// the newest Observation).
// ---------------------------------------------------------------------------

/** One Datastream → flood sensor record or null. */
export function normalizeFloodDatastream(stream) {
  const thing = stream?.Thing || {};
  const location = thing?.Locations?.[0]?.location;
  const coords = location?.coordinates || location?.geometry?.coordinates;
  const lon = num(coords?.[0]);
  const lat = num(coords?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!inTaiwanArea(lat, lon)) return null;
  const obs = stream?.Observations?.[0];
  const value = num(obs?.result);
  const props = thing?.properties || {};
  const id = String(
    props.stationID ||
      props.stationCode ||
      thing['@iot.id'] ||
      stream['@iot.id'] ||
      '',
  ).trim();
  if (!id) return null;
  const unit = String(stream?.unitOfMeasurement?.symbol || 'cm');
  const depthCm = Number.isFinite(value)
    ? /^m$/i.test(unit)
      ? value * 100
      : value
    : NaN;
  const status = !Number.isFinite(depthCm)
    ? WATER_STATUS.unknown
    : depthCm >= FLOOD_DEPTH_THRESHOLD_CM
      ? WATER_STATUS.flooded
      : WATER_STATUS.dry;
  return {
    kind: 'flood',
    id,
    name: String(props.stationName || thing.name || id).trim(),
    address: String(props.Address || props.address || '').trim(),
    lat,
    lon,
    value: depthCm,
    unit: 'cm',
    observedMs: taiwanTimeToMs(obs?.phenomenonTime),
    status: status.key,
  };
}

// ---------------------------------------------------------------------------
// Reservoirs. Neither reservoir dataset carries a position, so the major
// reservoirs are placed from this table (dam or lake centre, approximate) and
// matched by name from 水庫每日營運狀況; unlisted ones are left out.
// ---------------------------------------------------------------------------
export const RESERVOIR_POSITIONS = Object.freeze([
  { name: '新山水庫', lat: 25.1182, lon: 121.7393 },
  { name: '翡翠水庫', lat: 24.9087, lon: 121.5807 },
  { name: '石門水庫', lat: 24.8136, lon: 121.2453 },
  { name: '寶山第二水庫', lat: 24.7385, lon: 121.0577 },
  { name: '寶山水庫', lat: 24.7224, lon: 121.0532 },
  { name: '永和山水庫', lat: 24.6058, lon: 120.9395 },
  { name: '明德水庫', lat: 24.5815, lon: 120.8869 },
  { name: '鯉魚潭水庫', lat: 24.3314, lon: 120.7787 },
  { name: '德基水庫', lat: 24.2575, lon: 121.1659 },
  { name: '霧社水庫', lat: 24.0375, lon: 121.1281 },
  { name: '日月潭水庫', lat: 23.8604, lon: 120.9154 },
  { name: '湖山水庫', lat: 23.6436, lon: 120.6251 },
  { name: '仁義潭水庫', lat: 23.4672, lon: 120.5298 },
  { name: '蘭潭水庫', lat: 23.4697, lon: 120.4857 },
  { name: '白河水庫', lat: 23.3355, lon: 120.4919 },
  { name: '烏山頭水庫', lat: 23.2034, lon: 120.3882 },
  { name: '曾文水庫', lat: 23.2483, lon: 120.5287 },
  { name: '南化水庫', lat: 23.1045, lon: 120.4794 },
  { name: '鏡面水庫', lat: 23.0656, lon: 120.4128 },
  { name: '阿公店水庫', lat: 22.8045, lon: 120.3379 },
  { name: '澄清湖水庫', lat: 22.6578, lon: 120.3527 },
  { name: '牡丹水庫', lat: 22.1336, lon: 120.7868 },
  { name: '成功水庫', lat: 23.5893, lon: 119.6087 },
]);

const stripReservoir = (name) =>
  String(name || '')
    .replace(/\s+/g, '')
    .replace(/(水庫|攔河堰|堰|壩)$/, '');

/** Table entry whose name matches a WRA reservoir name, or null. */
export function reservoirPosition(name) {
  const key = stripReservoir(name);
  if (!key) return null;
  return (
    RESERVOIR_POSITIONS.find((r) => stripReservoir(r.name) === key) || null
  );
}

/**
 * Join 水庫每日營運狀況 (names, inflow/outflow) with 水庫水情資料 (level,
 * effective storage) by reservoir identifier.
 */
export function joinReservoirs(dailyRows, conditionRows) {
  const latest = new Map();
  for (const row of Array.isArray(conditionRows) ? conditionRows : []) {
    const id = String(row?.reservoiridentifier || '').trim();
    const at = taiwanTimeToMs(row?.observationtime);
    if (!id) continue;
    const prior = latest.get(id);
    if (!prior || at > prior.at) latest.set(id, { row, at });
  }
  const daily = new Map();
  for (const row of Array.isArray(dailyRows) ? dailyRows : []) {
    const id = String(row?.reservoiridentifier || '').trim();
    const at = taiwanTimeToMs(row?.datetime);
    if (!id) continue;
    const prior = daily.get(id);
    if (!prior || at > prior.at) daily.set(id, { row, at });
  }
  const out = [];
  for (const [id, { row }] of daily) {
    const name = String(row?.reservoirname || '').trim();
    const position = reservoirPosition(name);
    if (!position) continue;
    const condition = latest.get(id);
    const level = num(condition?.row?.waterlevel);
    const storage = num(condition?.row?.effectivewaterstoragecapacity);
    out.push({
      kind: 'reservoir',
      id,
      name,
      lat: position.lat,
      lon: position.lon,
      value: level,
      unit: 'm',
      storage, // 有效蓄水量, 萬立方公尺
      inflow: num(row?.inflow),
      outflow: num(row?.outflowtotal ?? row?.outflow),
      rainfall: num(row?.basinrainfall),
      observedMs: condition?.at ?? taiwanTimeToMs(row?.datetime),
      status: WATER_STATUS.reservoir.key,
    });
  }
  return out;
}

/** Validate a provider payload and return its three record lists. */
export function readWaterSnapshot(payload) {
  const list = (key) =>
    Array.isArray(payload?.[key])
      ? payload[key].filter(
          (r) => r && Number.isFinite(r.lat) && Number.isFinite(r.lon) && r.id,
        )
      : [];
  return {
    rivers: list('rivers'),
    floods: list('floods'),
    reservoirs: list('reservoirs'),
    fetchedAt: Number(payload?.fetchedAt) || null,
    errors: Array.isArray(payload?.errors) ? payload.errors.map(String) : [],
  };
}
