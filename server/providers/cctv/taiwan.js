// Taiwan road cameras, keyless.
//
// Two packs, both published under the Open Government Data License v1.0
// (政府資料開放授權條款 第1版, https://data.gov.tw/license):
//
//   thb  — 交通部公路局 (Highway Bureau): provincial highways and expressways.
//          MOTC v2.0 CCTV XML; every camera has a `/snapshot` JPEG still.
//   nfb  — 交通部高速公路局 (Freeway Bureau): national freeways. MOTC v2.0
//          CCTV XML (with the Highway Bureau's freeway JSON as a fallback);
//          the freeway publishes MJPEG streams only, so the frame endpoint
//          reads the first JPEG out of the stream (fetchMjpegFirstFrame).
//
// Neither publishes a camera pose; both use the app's low-confidence prior.
import { CCTV_SOURCE_FETCH_TIMEOUT_MS } from './constants.js';
import {
  cameraDisplayCode,
  fallbackHeadingFromId,
  prioritizeSources,
} from './normalize.js';
import { readResponseTextCapped } from '../common/http.js';

export const THB_CCTV_XML_URLS = Object.freeze([
  'https://cctv-maintain.thb.gov.tw/opendataCCTVs.xml',
  'https://thbapp.thb.gov.tw/opendata/cctv/info/cctvs.xml',
]);
export const NFB_CCTV_XML_URL =
  'https://tisvcloud.freeway.gov.tw/history/motc20/CCTV.xml';
export const NFB_CCTV_FALLBACK_JSON_URL =
  'https://thbapp.thb.gov.tw/services/cctv/freeway';
export const TAIWAN_MAX_CATALOG_BYTES = 12 * 1024 * 1024;

/** Taiwan main island plus Penghu, Kinmen and Matsu. */
export function inTaiwan(lat, lon) {
  return lat >= 21.8 && lat <= 26.5 && lon >= 118.0 && lon <= 122.2;
}

/** Spread a capped catalog across the island instead of only Taipei. */
export const TAIWAN_ANCHORS = Object.freeze([
  { lat: 25.0375, lon: 121.5637 }, // Taipei
  { lat: 24.9936, lon: 121.301 }, // Taoyuan
  { lat: 24.8138, lon: 120.9675 }, // Hsinchu
  { lat: 24.1477, lon: 120.6736 }, // Taichung
  { lat: 23.4801, lon: 120.4491 }, // Chiayi
  { lat: 22.9997, lon: 120.227 }, // Tainan
  { lat: 22.6273, lon: 120.3014 }, // Kaohsiung
  { lat: 22.6754, lon: 121.1468 }, // Taitung
  { lat: 23.9871, lon: 121.6015 }, // Hualien
  { lat: 24.7021, lon: 121.7378 }, // Yilan
]);

/** Camera hosts each pack may register. Anything else is dropped. */
const THB_HOST = /^cctv-ss\d{2}\.thb\.gov\.tw$/i;
const NFB_HOST = /^cctv[a-z]\d*\.freeway\.gov\.tw$/i;

const decodeXml = (text) =>
  String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();

/** One `<Tag>value</Tag>` (namespace prefix tolerated) from an element body. */
function tag(body, name) {
  const re = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${name}>`,
  );
  const m = re.exec(body);
  return m ? decodeXml(m[1]) : '';
}

/**
 * Parse a MOTC v2.0 `CCTVList` document into plain records.
 * @returns {Array<object>}
 */
export function parseMotcCctvXml(xml) {
  const out = [];
  const re =
    /<(?:[A-Za-z0-9_]+:)?CCTV(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?CCTV>/g;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const body = m[1];
    out.push({
      id: tag(body, 'CCTVID'),
      streamUrl: tag(body, 'VideoStreamURL'),
      imageUrl: tag(body, 'VideoImageURL'),
      lon: Number(tag(body, 'PositionLon')),
      lat: Number(tag(body, 'PositionLat')),
      description: tag(body, 'SurveillanceDescription'),
      roadName: tag(body, 'RoadName'),
      direction: tag(body, 'RoadDirection'),
      mile: tag(body, 'LocationMile'),
      subAuthority: tag(body, 'SubAuthorityCode'),
    });
  }
  return out;
}

/** A URL on an allowed camera host, rebuilt without credentials; else ''. */
function allowedUrl(raw, hostPattern) {
  try {
    const url = new URL(String(raw || '').trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    if (!hostPattern.test(url.hostname)) return '';
    // The freeway still publishes a few http:// stream hosts; prefer https.
    url.protocol = 'https:';
    return url.href;
  } catch {
    return '';
  }
}

/** Compass letter (N/S/E/W) of travel direction → camera heading. */
const DIRECTION_HEADING = { N: 0, E: 90, S: 180, W: 270 };

function poseFor(cameraId, direction) {
  const heading = DIRECTION_HEADING[String(direction || '').toUpperCase()];
  const known = Number.isFinite(heading);
  return {
    headingDeg: known ? heading : fallbackHeadingFromId(cameraId),
    headingConfidence: 'low',
    pitchDeg: -18,
    fovDeg: 50,
    rangeM: 180,
    mountHeightM: 9,
  };
}

const slug = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/** Highway Bureau record → camera source, or null. */
export function thbRecordToSource(record) {
  const lat = Number(record?.lat);
  const lon = Number(record?.lon);
  const id = slug(record?.id);
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!inTaiwan(lat, lon)) return null;
  // Prefer the published still; derive it from the stream when absent.
  const stream = allowedUrl(record?.streamUrl, THB_HOST);
  let snapshot = allowedUrl(record?.imageUrl, THB_HOST);
  if (!snapshot && stream) snapshot = `${stream.replace(/\/+$/, '')}/snapshot`;
  if (!snapshot) return null;
  const cameraId = `thb-${id}`;
  const name = String(
    record.description ||
      [record.roadName, record.mile].filter(Boolean).join(' ') ||
      record.id,
  )
    .trim()
    .slice(0, 160);
  return {
    id: cameraId,
    name,
    city: 'Taiwan · 公路局',
    cityId: 'taiwan-thb',
    provider: '交通部公路局 (Highway Bureau, MOTC)',
    lat,
    lon,
    ...poseFor(cameraId, record.direction),
    groundElevationM: 30,
    feedType: 'image',
    url: snapshot,
    snapshotUrl: snapshot,
    sourceKind: 'thb-open-data',
    license: 'Open Government Data License, version 1.0 (Taiwan)',
    credit: '交通部公路局 — 即時路況 CCTV（政府資料開放授權條款 1.0）',
    code: cameraDisplayCode(String(record.roadName || record.id).toUpperCase()),
  };
}

/** Freeway Bureau record → camera source, or null. */
export function nfbRecordToSource(record) {
  const lat = Number(record?.lat);
  const lon = Number(record?.lon);
  const id = slug(record?.id);
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!inTaiwan(lat, lon)) return null;
  const stream = allowedUrl(record?.streamUrl, NFB_HOST);
  if (!stream) return null;
  const cameraId = `nfb-${id}`;
  const name = String(
    record.description ||
      [record.roadName, record.mile].filter(Boolean).join(' ') ||
      record.id,
  )
    .trim()
    .slice(0, 160);
  return {
    id: cameraId,
    name,
    city: 'Taiwan · 國道',
    cityId: 'taiwan-nfb',
    provider: '交通部高速公路局 (Freeway Bureau, MOTC)',
    lat,
    lon,
    ...poseFor(cameraId, record.direction),
    groundElevationM: 30,
    // Stills: the frame endpoint takes the first JPEG of the MJPEG stream.
    feedType: 'image',
    url: stream,
    snapshotUrl: stream,
    sourceKind: 'nfb-mjpeg',
    license: 'Open Government Data License, version 1.0 (Taiwan)',
    credit: '交通部高速公路局 — 國道 CCTV（政府資料開放授權條款 1.0）',
    code: cameraDisplayCode(String(record.roadName || record.id).toUpperCase()),
  };
}

/** Highway Bureau freeway JSON row ({id, stakenumber, gisx, gisy, html}). */
export function nfbJsonRowToRecord(row) {
  const id = String(row?.id || '');
  // CCTV-N1-S-0.000-M → direction S
  const direction = /^CCTV-[^-]+-([NSEW])-/i.exec(id)?.[1] || '';
  return {
    id,
    streamUrl: row?.html,
    lon: Number(row?.gisx),
    lat: Number(row?.gisy),
    description: String(row?.stakenumber || ''),
    roadName: String(row?.stakenumber || '').split('(')[0],
    direction,
  };
}

async function fetchText(url, accept) {
  const signal = AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS);
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      'User-Agent': 'gods-eye-view-cctv-catalog/1.0',
    },
    redirect: 'follow',
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Catalog HTTP ${response.status}`);
  }
  // fetch() inflates a gzip Content-Encoding itself; a raw .gz body is not
  // expected for these URLs.
  return readResponseTextCapped(response, TAIWAN_MAX_CATALOG_BYTES, signal);
}

function capped(list, envName, fallback) {
  const unique = Array.from(new Map(list.map((c) => [c.id, c])).values());
  const raw = Number(process.env[envName] || fallback);
  const cap = Number.isFinite(raw)
    ? Math.max(8, Math.min(3000, Math.floor(raw)))
    : fallback;
  return { unique, kept: prioritizeSources(unique, cap, TAIWAN_ANCHORS) };
}

/** Highway Bureau pack: first catalog URL that answers wins. */
export async function loadTaiwanThbSources() {
  for (const url of THB_CCTV_XML_URLS) {
    try {
      const xml = await fetchText(url, 'application/xml, text/xml');
      const cameras = parseMotcCctvXml(xml)
        .map(thbRecordToSource)
        .filter(Boolean);
      if (!cameras.length) continue;
      const { unique, kept } = capped(
        cameras,
        'CCTV_TAIWAN_THB_MAX_SOURCES',
        800,
      );
      console.log(
        `[CCTV] Loaded Taiwan Highway Bureau cameras: ${unique.length} (using ${kept.length})`,
      );
      return kept;
    } catch (error) {
      console.warn(
        '[CCTV] Taiwan Highway Bureau catalog error:',
        error?.message || error,
      );
    }
  }
  return [];
}

/** Freeway Bureau pack: MOTC XML, falling back to the Highway Bureau's JSON. */
export async function loadTaiwanNfbSources() {
  let records = [];
  try {
    records = parseMotcCctvXml(
      await fetchText(NFB_CCTV_XML_URL, 'application/xml, text/xml'),
    );
  } catch (error) {
    console.warn('[CCTV] Taiwan freeway XML error:', error?.message || error);
  }
  if (!records.length) {
    try {
      const payload = JSON.parse(
        await fetchText(NFB_CCTV_FALLBACK_JSON_URL, 'application/json'),
      );
      records = (Array.isArray(payload) ? payload : []).map(nfbJsonRowToRecord);
    } catch (error) {
      console.warn(
        '[CCTV] Taiwan freeway fallback error:',
        error?.message || error,
      );
    }
  }
  const cameras = records.map(nfbRecordToSource).filter(Boolean);
  if (!cameras.length) return [];
  const { unique, kept } = capped(cameras, 'CCTV_TAIWAN_NFB_MAX_SOURCES', 800);
  console.log(
    `[CCTV] Loaded Taiwan freeway cameras: ${unique.length} (using ${kept.length})`,
  );
  return kept;
}
