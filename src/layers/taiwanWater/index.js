import * as Cesium from 'cesium';
import { msg, t, formatNumber } from '../../i18n/index.js';
import { WATER_STATUS } from './records.js';
export * from './records.js';
export { createTaiwanWaterSource } from './source.js';

export const TAIWAN_WATER_OVERLAY_SOURCE_ID = 'taiwan-water';
const OVERLAY_COHORT_LIMIT = 60;
const OVERLAY_COLLISION_CAPACITY = 40;
/** Camera heights below which a kind's ordinary readings get labels (m). */
const LABEL_HEIGHT_M = { river: 40_000, flood: 15_000, reservoir: 400_000 };
/** Points fade out beyond this (flooded sensors and alerts always show). */
const POINT_RANGE_M = { river: 400_000, flood: 120_000, reservoir: 1_200_000 };
const PIXEL_SIZE = { river: 8, flood: 6, reservoir: 13 };
const ALERT = new Set(['watch', 'warning', 'danger', 'flooded']);

const fixed = (value, digits) =>
  Number.isFinite(value)
    ? formatNumber(value, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '—';

/** The label a record shows on the globe. */
export function waterLabel(record) {
  if (record.kind === 'river')
    return t('{name} · level {value} m', {
      name: record.river ? `${record.name}（${record.river}）` : record.name,
      value: fixed(record.value, 2),
    });
  if (record.kind === 'flood')
    return t('{name} · flood depth {value} cm', {
      name: record.name,
      value: fixed(record.value, 0),
    });
  return t('{name} · level {value} m · storage {storage} ×10⁴ m³', {
    name: record.name,
    value: fixed(record.value, 2),
    storage: fixed(record.storage, 0),
  });
}

/** Own the Taiwan water display (river levels, flood sensors, reservoirs). */
export function createTaiwanWaterLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Taiwan water requires a snapshot source');
  if (!overlayHost)
    throw new TypeError('Taiwan water requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _records = [];
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let rowControlsListener = null;
  const notify = () => rowControlsListener?.();

  function render() {
    if (!_dataSource) return;
    const entities = _dataSource.entities;
    entities.suspendEvents();
    entities.removeAll();
    for (const record of _records) {
      const status = WATER_STATUS[record.status] || WATER_STATUS.unknown;
      const color = Cesium.Color.fromCssColorString(status.color);
      const alert = ALERT.has(record.status);
      const pointRange = alert ? 2_000_000 : POINT_RANGE_M[record.kind];
      entities.add(
        new Cesium.Entity({
          id: `taiwan-water:${record.kind}:${record.id}`,
          position: Cesium.Cartesian3.fromDegrees(record.lon, record.lat),
          point: {
            pixelSize: PIXEL_SIZE[record.kind] + (alert ? 4 : 0),
            color,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
            outlineWidth: 1.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
              0,
              pointRange,
            ),
          },
          properties: { ...record },
        }),
      );
    }
    entities.resumeEvents();
    syncLabels();
    _viewer?.scene?.requestRender?.();
  }

  /** Overlay labels for what the camera can usefully read right now. */
  function syncLabels() {
    if (!_enabled || !_viewer) return;
    const camera = _viewer.camera;
    const height = camera.positionCartographic?.height ?? Infinity;
    const rect = camera.computeViewRectangle?.();
    const toDeg = Cesium.Math.toDegrees;
    const inView = (r) => {
      if (!rect) return true;
      const west = toDeg(rect.west);
      const east = toDeg(rect.east);
      const lonOk =
        west <= east
          ? r.lon >= west && r.lon <= east
          : r.lon >= west || r.lon <= east;
      return lonOk && r.lat >= toDeg(rect.south) && r.lat <= toDeg(rect.north);
    };
    const entries = [];
    for (const record of _records) {
      const alert = ALERT.has(record.status);
      if (!alert && height > LABEL_HEIGHT_M[record.kind]) continue;
      if (!inView(record)) continue;
      const status = WATER_STATUS[record.status] || WATER_STATUS.unknown;
      entries.push({
        id: `${record.kind}:${record.id}`,
        position: Cesium.Cartesian3.fromDegrees(record.lon, record.lat),
        variant: 'label',
        title: waterLabel(record),
        accent: status.color,
        priority:
          (alert ? 100_000 : 0) +
          (record.kind === 'reservoir' ? 50_000 : 0) +
          (record.kind === 'river' ? 10_000 : 0) +
          (Number.isFinite(record.value)
            ? Math.min(9_999, Math.abs(record.value))
            : 0),
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 12,
        verticalOnly: true,
        placement: 'above',
      });
    }
    entries.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    overlayHost.setEntries(
      TAIWAN_WATER_OVERLAY_SOURCE_ID,
      entries.slice(0, OVERLAY_COHORT_LIMIT),
      {
        cohortLimit: OVERLAY_COHORT_LIMIT,
        collisionCapacity: OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }
  const onMoveEnd = () => syncLabels();

  const counts = () => ({
    rivers: _records.filter((r) => r.kind === 'river').length,
    floods: _records.filter((r) => r.kind === 'flood').length,
    reservoirs: _records.filter((r) => r.kind === 'reservoir').length,
    alerts: _records.filter((r) => ALERT.has(r.status)).length,
  });

  const layer = {
    id: 'taiwan-water',
    name: 'Taiwan water',
    icon: '💧',
    source: 'WRA · Civil IoT Taiwan',
    updateInterval: 600_000,

    init(viewer) {
      if (_viewer) throw new Error('Taiwan water layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('taiwan-water');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      viewer.camera.moveEnd.addEventListener(onMoveEnd);
      overlayHost.setVisible(TAIWAN_WATER_OVERLAY_SOURCE_ID, false);
      _records = [];
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(TAIWAN_WATER_OVERLAY_SOURCE_ID, true);
      syncLabels();
      notify();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(TAIWAN_WATER_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(TAIWAN_WATER_OVERLAY_SOURCE_ID, false);
      notify();
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _records = [
          ...snapshot.reservoirs,
          ...snapshot.rivers,
          ...snapshot.floods,
        ];
        render();
        _lastUpdate = Date.now();
        _lastError = snapshot.errors.length ? snapshot.errors.join('; ') : null;
        notify();
        return _records.length > 0;
      } catch (error) {
        if (request.signal.aborted || _request !== request) return false;
        _lastError = error?.message || msg('Taiwan water request failed');
        console.warn('[Data:TaiwanWater] Refresh failed:', _lastError);
        notify();
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      viewer?.camera?.moveEnd?.removeEventListener(onMoveEnd);
      overlayHost.clearSource(TAIWAN_WATER_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(TAIWAN_WATER_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _records = [];
      rowControlsListener = null;
    },

    /** Layers-panel row: a legend with live counts and one info line. */
    getRowControls() {
      const c = counts();
      const countOf = (key) => _records.filter((r) => r.status === key).length;
      return {
        legend: [
          WATER_STATUS.danger,
          WATER_STATUS.warning,
          WATER_STATUS.watch,
          WATER_STATUS.normal,
          WATER_STATUS.flooded,
          WATER_STATUS.reservoir,
        ].map((s) => ({
          color: s.color,
          label: t(s.label),
          count: countOf(s.key),
        })),
        info: t(
          '{rivers} river gauges · {floods} flood sensors · {reservoirs} reservoirs',
          c,
        ),
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getAnalystRecords(maxCount = 500) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 500;
      // Alerts first, so a capped answer keeps what matters.
      return [..._records]
        .sort((a, b) => ALERT.has(b.status) - ALERT.has(a.status))
        .slice(0, limit)
        .map((r) => ({
          kind: r.kind,
          id: r.id,
          name: r.name,
          river: r.river || undefined,
          lat: r.lat,
          lon: r.lon,
          value: r.value,
          unit: r.unit,
          storage: r.storage,
          status: r.status,
          observedMs: Number.isFinite(r.observedMs) ? r.observedMs : undefined,
        }));
    },

    getStats() {
      const newest = _records.reduce(
        (max, r) =>
          Math.max(max, Number.isFinite(r.observedMs) ? r.observedMs : 0),
        0,
      );
      return {
        count: _records.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
        observedAt: newest || null,
        stale: newest ? Date.now() - newest > 3 * 60 * 60_000 : false,
      };
    },
  };
  return layer;
}
