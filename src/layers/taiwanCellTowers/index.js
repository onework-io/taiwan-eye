import * as Cesium from 'cesium';
import { msg, t, formatNumber } from '../../i18n/index.js';
export * from './records.js';
export { createTaiwanCellTowersSource } from './source.js';

const POINT_COLOR = '#ffb547';

/** Own the Taiwan cell tower display: ~84k points in one primitive batch. */
export function createTaiwanCellTowersLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Taiwan cell towers requires a snapshot source');
  let _viewer = null;
  let _points = null;
  let _request = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let rowControlsListener = null;
  const notify = () => rowControlsListener?.();

  function render() {
    if (!_points) return;
    _points.removeAll();
    const flat = _snapshot?.points || [];
    const color = Cesium.Color.fromCssColorString(POINT_COLOR).withAlpha(0.85);
    const outline = Cesium.Color.BLACK.withAlpha(0.55);
    // Big at street level, a fine dust over the whole island.
    const scale = new Cesium.NearFarScalar(1_500, 2.2, 1_200_000, 0.55);
    for (let i = 0; i + 1 < flat.length; i += 2) {
      _points.add({
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

  const layer = {
    id: 'taiwan-cell-towers',
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
      _viewer?.scene?.requestRender?.();
      notify();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_points) _points.show = false;
      _viewer?.scene?.requestRender?.();
      notify();
    },

    async update() {
      if (!_enabled || !_points) return false;
      // Positions never change between refreshes; only re-render when they do.
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
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
