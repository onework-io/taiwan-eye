/**
 * Taiwan 3D buildings overlay (Taiwan edition).
 *
 * 內政部國土測繪中心 (NLSC) publishes keyless OGC 3D Tiles 1.1 building models
 * for every county and city (https://3dtiles.nlsc.gov.tw/tiles3d/Service).
 * They are a buildings-only skin, so unlike the photoreal stack they sit ON
 * TOP of the imagery globe and its terrain: this overlay shows them whenever
 * an imagery map source is active (globe shown) and hides them under the
 * photoreal stack, whose own mesh already carries buildings.
 *
 * Each county's tileset.json is large (Taipei's is ~15 MB, 85,000 tiles), so
 * only the counties near the camera are loaded, at most MAX_LOADED at a time;
 * the least recently needed one is destroyed when another must load.
 *
 * The tilesets live inside one PrimitiveCollection rather than directly in
 * scene.primitives. Several layers scan the top-level primitives for "the"
 * photoreal tileset (tilesLoaded readiness, mesh sampling); nesting keeps
 * this overlay out of those scans. scene.sampleHeight still sees it, so the
 * camera ground guard stays above rooftops.
 */

/** NLSC catalog. `id` is the path segment under building/tiles3d/. Where a
 * county has a per-building (分棟版) model it is preferred. Centres and radii
 * are coarse county extents used only to decide what to load. */
export const TAIWAN_BUILDING_TILESETS = Object.freeze([
  {
    key: 'taipei',
    name: '臺北市',
    id: 30,
    lat: 25.08,
    lon: 121.56,
    radiusKm: 17,
  },
  {
    key: 'newtaipei',
    name: '新北市',
    id: 35,
    lat: 24.99,
    lon: 121.6,
    radiusKm: 45,
  },
  {
    key: 'keelung',
    name: '基隆市',
    id: 2,
    lat: 25.12,
    lon: 121.72,
    radiusKm: 12,
  },
  {
    key: 'taoyuan',
    name: '桃園市',
    id: 37,
    lat: 24.9,
    lon: 121.22,
    radiusKm: 35,
  },
  {
    key: 'hsinchucity',
    name: '新竹市',
    id: 13,
    lat: 24.8,
    lon: 120.95,
    radiusKm: 10,
  },
  {
    key: 'hsinchucounty',
    name: '新竹縣',
    id: 39,
    lat: 24.7,
    lon: 121.12,
    radiusKm: 35,
  },
  {
    key: 'miaoli',
    name: '苗栗縣',
    id: 40,
    lat: 24.49,
    lon: 120.95,
    radiusKm: 35,
  },
  {
    key: 'taichung',
    name: '臺中市',
    id: 1,
    lat: 24.23,
    lon: 120.85,
    radiusKm: 45,
  },
  {
    key: 'changhua',
    name: '彰化縣',
    id: 42,
    lat: 23.99,
    lon: 120.48,
    radiusKm: 30,
  },
  {
    key: 'nantou',
    name: '南投縣',
    id: 41,
    lat: 23.83,
    lon: 120.98,
    radiusKm: 50,
  },
  {
    key: 'yunlin',
    name: '雲林縣',
    id: 44,
    lat: 23.7,
    lon: 120.39,
    radiusKm: 30,
  },
  {
    key: 'chiayicity',
    name: '嘉義市',
    id: 8,
    lat: 23.48,
    lon: 120.45,
    radiusKm: 8,
  },
  {
    key: 'chiayicounty',
    name: '嘉義縣',
    id: 45,
    lat: 23.45,
    lon: 120.5,
    radiusKm: 40,
  },
  {
    key: 'tainan',
    name: '臺南市',
    id: 3,
    lat: 23.1,
    lon: 120.28,
    radiusKm: 40,
  },
  {
    key: 'kaohsiung',
    name: '高雄市',
    id: 4,
    lat: 22.85,
    lon: 120.5,
    radiusKm: 55,
  },
  {
    key: 'pingtung',
    name: '屏東縣',
    id: 46,
    lat: 22.45,
    lon: 120.6,
    radiusKm: 55,
  },
  {
    key: 'yilan',
    name: '宜蘭縣',
    id: 36,
    lat: 24.65,
    lon: 121.65,
    radiusKm: 40,
  },
  {
    key: 'hualien',
    name: '花蓮縣',
    id: 47,
    lat: 23.8,
    lon: 121.45,
    radiusKm: 75,
  },
  {
    key: 'taitung',
    name: '臺東縣',
    id: 48,
    lat: 22.85,
    lon: 121.1,
    radiusKm: 75,
  },
  {
    key: 'penghu',
    name: '澎湖縣',
    id: 19,
    lat: 23.57,
    lon: 119.6,
    radiusKm: 30,
  },
  {
    key: 'kinmen',
    name: '金門縣',
    id: 20,
    lat: 24.44,
    lon: 118.37,
    radiusKm: 15,
  },
  {
    key: 'lienchiang',
    name: '連江縣',
    id: 21,
    lat: 26.16,
    lon: 119.95,
    radiusKm: 20,
  },
]);

export const TAIWAN_BUILDINGS_BASE_URL =
  'https://3dtiles.nlsc.gov.tw/building/tiles3d';
export const TAIWAN_BUILDINGS_STORAGE_KEY = 'gev:taiwan-3d-buildings:v1';
/** Above this camera height the overlay is hidden (buildings are invisible). */
export const MAX_VIEW_HEIGHT_M = 60000;
/** Load a county when the camera's ground point is this close to its edge. */
export const LOAD_MARGIN_KM = 8;
export const MAX_LOADED = 3;

export function tilesetUrl(entry) {
  return `${TAIWAN_BUILDINGS_BASE_URL}/${entry.id}/tileset.json`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Counties to show for a camera ground point, nearest first, at most `max`.
 * @returns {Array<object>}
 */
export function countiesNear(
  lat,
  lon,
  { margin = LOAD_MARGIN_KM, max = MAX_LOADED } = {},
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  return TAIWAN_BUILDING_TILESETS.map((entry) => ({
    entry,
    gap: haversineKm(lat, lon, entry.lat, entry.lon) - entry.radiusKm,
  }))
    .filter(({ gap }) => gap <= margin)
    .sort((a, b) =>
      // Inside counties first, the most specific (smallest) one leading;
      // then the nearest edges.
      a.gap <= 0 && b.gap <= 0
        ? a.entry.radiusKm - b.entry.radiusKm
        : a.gap - b.gap,
    )
    .slice(0, max)
    .map(({ entry }) => entry);
}

export function readStoredEnabled(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem?.(TAIWAN_BUILDINGS_STORAGE_KEY);
    return value == null ? true : value !== '0';
  } catch {
    return true;
  }
}

function writeStoredEnabled(enabled, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(TAIWAN_BUILDINGS_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

/** Window events: the UI asks with TOGGLE_EVENT, the overlay answers with STATE_EVENT. */
export const TOGGLE_EVENT = 'gev:taiwan-3d-toggle';
export const STATE_EVENT = 'gev:taiwan-3d-state';

/**
 * Attach the overlay to a viewer.
 * @param {import('cesium').Viewer} viewer
 * @param {object} options
 * @param {typeof import('cesium')} options.Cesium
 * @param {() => void} [options.requestRender]
 * @returns {{ setEnabled(on: boolean): void, isEnabled(): boolean, update(): void, destroy(): void }}
 */
export function createTaiwanBuildingsOverlay(
  viewer,
  { Cesium, requestRender = () => {}, storage = globalThis.localStorage } = {},
) {
  const scene = viewer.scene;
  const collection = scene.primitives.add(
    new Cesium.PrimitiveCollection({ destroyPrimitives: true }),
  );
  /** key → { tileset|null, loading: Promise|null, lastUsed } */
  const loaded = new Map();
  let enabled = readStoredEnabled(storage);
  let destroyed = false;
  let lastActive = [];

  const emit = () => {
    try {
      globalThis.dispatchEvent?.(
        new CustomEvent(STATE_EVENT, {
          detail: { enabled, active: lastActive.map((e) => e.name) },
        }),
      );
    } catch {
      /* no window (tests) */
    }
  };

  function cameraGroundPoint() {
    const carto = scene.camera.positionCartographic;
    const height = carto?.height;
    // Prefer the point at the centre of the view; fall back to the camera's
    // own nadir when the view centre is sky.
    const canvas = scene.canvas;
    let target = null;
    try {
      const ray = scene.camera.getPickRay(
        new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
      );
      const hit = ray && scene.globe.pick(ray, scene);
      if (hit) target = Cesium.Cartographic.fromCartesian(hit);
    } catch {
      target = null;
    }
    const point = target || carto;
    return {
      lat: Cesium.Math.toDegrees(point.latitude),
      lon: Cesium.Math.toDegrees(point.longitude),
      height,
    };
  }

  async function load(entry) {
    const record = loaded.get(entry.key) || {
      tileset: null,
      loading: null,
      lastUsed: 0,
    };
    loaded.set(entry.key, record);
    record.lastUsed = Date.now();
    if (record.tileset || record.loading) return record.loading;
    record.loading = Cesium.Cesium3DTileset.fromUrl(tilesetUrl(entry), {
      maximumScreenSpaceError: 16,
      cacheBytes: 384 * 1024 * 1024,
      maximumCacheOverflowBytes: 256 * 1024 * 1024,
      // Rooftops stop the camera like the photoreal mesh does.
      enableCollision: true,
    })
      .then((tileset) => {
        if (destroyed || !loaded.has(entry.key)) {
          tileset.destroy();
          return;
        }
        tileset.show = false;
        collection.add(tileset);
        record.tileset = tileset;
        update();
      })
      .catch((error) => {
        console.warn(
          `[Taiwan3D] ${entry.name} buildings failed to load:`,
          error?.message || error,
        );
        loaded.delete(entry.key);
      })
      .finally(() => {
        record.loading = null;
      });
    return record.loading;
  }

  function evict(keep) {
    const keepKeys = new Set(keep.map((e) => e.key));
    const extra = [...loaded.entries()]
      .filter(([key]) => !keepKeys.has(key))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (loaded.size > MAX_LOADED && extra.length) {
      const [key, record] = extra.shift();
      loaded.delete(key);
      if (record.tileset) collection.remove(record.tileset);
    }
  }

  function update() {
    if (destroyed) return;
    const { lat, lon, height } = cameraGroundPoint();
    const globeStack = scene.globe?.show !== false;
    const active =
      enabled &&
      globeStack &&
      Number.isFinite(height) &&
      height < MAX_VIEW_HEIGHT_M
        ? countiesNear(lat, lon)
        : [];
    for (const entry of active) void load(entry);
    const activeKeys = new Set(active.map((e) => e.key));
    for (const [key, record] of loaded) {
      if (record.tileset) record.tileset.show = activeKeys.has(key);
    }
    evict(active);
    const changed =
      active.length !== lastActive.length ||
      active.some((e, i) => e.key !== lastActive[i]?.key);
    lastActive = active;
    if (changed) emit();
    requestRender();
  }

  const onMoveEnd = () => update();
  scene.camera.moveEnd.addEventListener(onMoveEnd);
  const onStack = () => setTimeout(update, 0);
  const onToggle = (event) => {
    const next =
      typeof event?.detail?.enabled === 'boolean'
        ? event.detail.enabled
        : !enabled;
    api.setEnabled(next);
  };
  globalThis.addEventListener?.('gev:map-stack-changed', onStack);
  globalThis.addEventListener?.(TOGGLE_EVENT, onToggle);

  const api = {
    setEnabled(on) {
      enabled = !!on;
      writeStoredEnabled(enabled, storage);
      update();
      emit();
    },
    isEnabled: () => enabled,
    activeCounties: () => lastActive.map((e) => e.name),
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      scene.camera.moveEnd.removeEventListener(onMoveEnd);
      globalThis.removeEventListener?.('gev:map-stack-changed', onStack);
      globalThis.removeEventListener?.(TOGGLE_EVENT, onToggle);
      loaded.clear();
      if (!scene.isDestroyed?.()) scene.primitives.remove(collection);
    },
  };
  update();
  emit();
  return api;
}
