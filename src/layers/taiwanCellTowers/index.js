import * as Cesium from 'cesium';
import { msg, t, formatNumber } from '../../i18n/index.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import {
  registerPickOwner,
  unregisterPickOwner,
} from '../../data/pickRegistry.js';
import { normalizeCounty, towerNeighborhood } from './records.js';
export * from './records.js';
export { createTaiwanCellTowersSource } from './source.js';

const LAYER_ID = 'taiwan-cell-towers';
const POINT_COLOR = '#ffb547';
const SELECTED_COLOR = '#00ffff';
/** Pick ids are `taiwan-cell-tower:<index>`; nothing else uses the prefix. */
export const TOWER_PICK_PREFIX = 'taiwan-cell-tower:';
export const TOWER_SELECTED_OVERLAY_SOURCE_ID = 'taiwan-cell-tower-selected';
const SELECTED_OVERLAY_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 0,
  moving: false,
});
const NEARBY_RADIUS_M = 500;

/** Tower index for a pick id, or -1. */
export function towerIndexFromPickId(id) {
  if (typeof id !== 'string' || !id.startsWith(TOWER_PICK_PREFIX)) return -1;
  const index = Number(id.slice(TOWER_PICK_PREFIX.length));
  return Number.isInteger(index) && index >= 0 ? index : -1;
}

const distanceText = (m) =>
  m == null
    ? '—'
    : m >= 1000
      ? `${formatNumber(m / 1000, { maximumFractionDigits: 1 })} km`
      : `${formatNumber(Math.round(m))} m`;

/**
 * The card for one tower: what this dataset can honestly say about it.
 * @param {object} input
 * @returns {{title: string, details: string[]}}
 */
export function buildTowerCard({
  index,
  lon,
  lat,
  neighborhood,
  place = null,
  placePending = false,
  stats = null,
  pointsAsOf = null,
}) {
  const details = [
    `${lat.toFixed(5)}°N  ${lon.toFixed(5)}°E`,
    placePending
      ? t('Looking up location…')
      : place?.county
        ? [place.county, place.district].filter(Boolean).join(' ')
        : t('Location unavailable'),
    t('{count} other sites within {radius} · nearest {nearest}', {
      count: formatNumber(neighborhood.within),
      radius: `${NEARBY_RADIUS_M} m`,
      nearest: distanceText(neighborhood.nearestM),
    }),
  ];
  const county = place?.county ? normalizeCounty(place.county) : '';
  const countyStats = county ? stats?.byCounty?.[county] : null;
  if (countyStats) {
    details.push(
      t('NCC {county} ({period}): 4G {g4} · 5G {g5}', {
        county,
        period: stats.period,
        g4: formatNumber(countyStats.byTech['4G'] || 0),
        g5: formatNumber(countyStats.byTech['5G'] || 0),
      }),
    );
    const operators = Object.entries(countyStats.byOperator || {})
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name} ${formatNumber(n)}`)
      .join(' · ');
    if (operators) details.push(operators);
  }
  details.push(
    t('Position from the {asOf} community snapshot; operator not recorded', {
      asOf: pointsAsOf || '—',
    }),
  );
  return {
    title: t('Cell tower site #{number}', { number: formatNumber(index + 1) }),
    details,
  };
}

/** Own the Taiwan cell tower display: ~84k points in one primitive batch. */
export function createTaiwanCellTowersLayer({
  source,
  overlayHost = null,
  documentRef = globalThis.document,
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Taiwan cell towers requires a snapshot source');
  let _viewer = null;
  let _points = null;
  let _request = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _clickHandler = null;
  let _selected = -1;
  let _placeRequest = null;
  let rowControlsListener = null;
  const notify = () => rowControlsListener?.();
  const pointColor = () =>
    Cesium.Color.fromCssColorString(POINT_COLOR).withAlpha(0.85);

  function render() {
    if (!_points) return;
    clearSelection();
    _points.removeAll();
    const flat = _snapshot?.points || [];
    const color = pointColor();
    const outline = Cesium.Color.BLACK.withAlpha(0.55);
    // Big at street level, a fine dust over the whole island.
    const scale = new Cesium.NearFarScalar(1_500, 2.2, 1_200_000, 0.55);
    for (let i = 0; i + 1 < flat.length; i += 2) {
      _points.add({
        id: `${TOWER_PICK_PREFIX}${i / 2}`,
        position: Cesium.Cartesian3.fromDegrees(flat[i], flat[i + 1], 30),
        pixelSize: 4,
        color,
        outlineColor: outline,
        outlineWidth: 1,
        scaleByDistance: scale,
      });
    }
    _viewer?.scene?.requestRender?.();
  }

  function showCard(index, extra) {
    const flat = _snapshot?.points;
    const point = _points?.get?.(index);
    if (!flat || !point || !overlayHost) return;
    const lon = flat[index * 2];
    const lat = flat[index * 2 + 1];
    const card = buildTowerCard({
      index,
      lon,
      lat,
      stats: _snapshot.stats,
      pointsAsOf: _snapshot.pointsAsOf,
      ...extra,
    });
    overlayHost.setEntries(
      TOWER_SELECTED_OVERLAY_SOURCE_ID,
      [
        {
          id: `${TOWER_PICK_PREFIX}${index}`,
          position: point.position,
          variant: 'selected',
          selected: true,
          protected: true,
          paintLane: 'selected',
          collisionGroup: 'ambient-card',
          priority: Number.MAX_SAFE_INTEGER,
          title: card.title,
          details: card.details,
          accent: SELECTED_COLOR,
          interactive: false,
          anchorRadiusPx: 9,
          minAnchorGapPx: 11,
          verticalOnly: true,
          placement: 'above',
          edgeFade: 'keyhole',
          horizonCull: true,
          terrainOcclusion: false,
        },
      ],
      SELECTED_OVERLAY_OPTIONS,
    );
  }

  function selectTower(index) {
    const flat = _snapshot?.points;
    if (!flat || index * 2 + 1 >= flat.length) return;
    clearSelection();
    _selected = index;
    const point = _points?.get?.(index);
    if (point) {
      point.color = Cesium.Color.fromCssColorString(SELECTED_COLOR);
      point.pixelSize = 9;
    }
    const neighborhood = towerNeighborhood(flat, index, NEARBY_RADIUS_M);
    const canLookUp = typeof source.whereIs === 'function';
    showCard(index, { neighborhood, placePending: canLookUp });
    _viewer?.scene?.requestRender?.();
    if (!canLookUp) return;
    const request = new AbortController();
    _placeRequest = request;
    source
      .whereIs(flat[index * 2 + 1], flat[index * 2], { signal: request.signal })
      .then(
        (place) => place,
        () => null,
      )
      .then((place) => {
        if (request.signal.aborted || _selected !== index) return;
        showCard(index, { neighborhood, place });
        _viewer?.scene?.requestRender?.();
      });
  }

  function clearSelection() {
    _placeRequest?.abort();
    _placeRequest = null;
    if (_selected >= 0) {
      const point = _points?.get?.(_selected);
      if (point) {
        point.color = pointColor();
        point.pixelSize = 4;
      }
    }
    _selected = -1;
    overlayHost?.clearSource?.(TOWER_SELECTED_OVERLAY_SOURCE_ID);
    _viewer?.scene?.requestRender?.();
  }

  function onKeyDown(event) {
    if (event?.key === 'Escape' && _selected >= 0) clearSelection();
  }

  function installClickHandler() {
    if (_clickHandler || !_viewer) return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(_viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      // A tool owns the pointer (src/data/inputOwnership.js): yield the click.
      if (!isPointerFree()) return;
      const picked = _viewer.scene.pick(click.position);
      const index = towerIndexFromPickId(picked?.primitive?.id ?? picked?.id);
      if (index >= 0) {
        selectTower(index);
        return;
      }
      if (_selected >= 0) clearSelection();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    documentRef?.addEventListener?.('keydown', onKeyDown);
    registerPickOwner(LAYER_ID, (id) => towerIndexFromPickId(id) >= 0);
  }

  function removeClickHandler() {
    clearSelection();
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    documentRef?.removeEventListener?.('keydown', onKeyDown);
    unregisterPickOwner(LAYER_ID);
  }

  const layer = {
    id: LAYER_ID,
    name: 'Taiwan cell towers',
    icon: '📡',
    source: 'NCC · loxyz-tw/cell_tower_tw',
    // Positions are a fixed snapshot and NCC updates irregularly.
    updateInterval: 6 * 60 * 60_000,

    init(viewer) {
      if (_viewer)
        throw new Error('Taiwan cell towers layer is already initialized');
      _viewer = viewer;
      _points = viewer.scene.primitives.add(
        new Cesium.PointPrimitiveCollection(),
      );
      _points.show = false;
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      installClickHandler();
      _viewer?.scene?.requestRender?.();
      notify();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      removeClickHandler();
      if (_points) _points.show = false;
      _viewer?.scene?.requestRender?.();
      notify();
    },

    async update() {
      if (!_enabled || !_points) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        // Positions never change between refreshes; only re-render when they do.
        const changed =
          !_snapshot || _snapshot.points.length !== snapshot.points.length;
        _snapshot = snapshot;
        if (changed) render();
        _lastUpdate = Date.now();
        _lastError = snapshot.errors.length ? snapshot.errors.join('; ') : null;
        notify();
        return snapshot.points.length > 0 || Boolean(snapshot.stats);
      } catch (error) {
        if (request.signal.aborted || _request !== request) return false;
        _lastError = error?.message || msg('Taiwan cell tower request failed');
        console.warn('[Data:TaiwanCellTowers] Refresh failed:', _lastError);
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
      removeClickHandler();
      if (_points && !viewer?.scene?.isDestroyed?.())
        viewer?.scene?.primitives?.remove(_points);
      _points = null;
      _viewer = null;
      _snapshot = null;
      rowControlsListener = null;
    },

    /** Layers-panel row: site count, then NCC's current 4G/5G licences. */
    getRowControls() {
      const count = (_snapshot?.points?.length || 0) / 2;
      const parts = [];
      if (count)
        parts.push(
          t('{count} tower sites (positions as of {asOf})', {
            count: formatNumber(count),
            asOf: _snapshot.pointsAsOf || '—',
          }),
        );
      const stats = _snapshot?.stats;
      if (stats?.byTech)
        parts.push(
          t('NCC {period}: 4G {g4} · 5G {g5}', {
            period: stats.period,
            g4: formatNumber(stats.byTech['4G'] || 0),
            g5: formatNumber(stats.byTech['5G'] || 0),
          }),
        );
      const operators = Object.entries(stats?.byOperator || {})
        .sort((a, b) => b[1] - a[1])
        .map(([name, n]) => `${name} ${formatNumber(n)}`)
        .join(' · ');
      return {
        info: parts.join(' · ') || null,
        infoTitle: operators,
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getAnalystRecords() {
      return [];
    },

    getStats() {
      return {
        count: (_snapshot?.points?.length || 0) / 2,
        lastUpdate: _lastUpdate,
        error: _lastError,
        observedAt: null,
        stale: false,
      };
    },
  };
  return layer;
}
