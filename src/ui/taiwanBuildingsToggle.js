/**
 * The TAIWAN 3D BUILDINGS chip in the Map Source panel. It talks to the
 * overlay (src/maps/taiwanBuildings.js) only through window events, so the
 * panel needs no handle on the viewer.
 * @module ui/taiwanBuildingsToggle
 */
import { t } from '../i18n/index.js';
import {
  TOGGLE_EVENT,
  STATE_EVENT,
  readStoredEnabled,
} from '../maps/taiwanBuildings.js';

/** Chip tooltip for the overlay state. */
export function taiwanBuildingsTitle({ enabled, active = [] }) {
  if (!enabled) return t('Show NLSC 3D buildings for Taiwan');
  if (!active.length)
    return t('NLSC 3D buildings on — zoom in over Taiwan on an imagery map');
  return t('NLSC 3D buildings: {counties}', { counties: active.join('、') });
}

/**
 * Bind the chip. Returns an unbind function; a document without the chip
 * binds nothing.
 * @param {Document} doc
 * @returns {() => void}
 */
export function bindTaiwanBuildingsToggle(doc = globalThis.document) {
  const button = doc?.getElementById?.('taiwan-3d-toggle');
  if (!button) return () => {};
  const view = globalThis;
  const render = (state) => {
    button.classList.toggle('active', !!state.enabled);
    button.setAttribute('aria-pressed', String(!!state.enabled));
    button.title = taiwanBuildingsTitle(state);
  };
  render({ enabled: readStoredEnabled() });
  const onClick = () => {
    view.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
  };
  const onState = (event) => render(event.detail || {});
  button.addEventListener('click', onClick);
  view.addEventListener(STATE_EVENT, onState);
  return () => {
    button.removeEventListener('click', onClick);
    view.removeEventListener(STATE_EVENT, onState);
  };
}
