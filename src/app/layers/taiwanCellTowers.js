import { createTaiwanCellTowersLayer } from '../../layers/taiwanCellTowers/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire Taiwan cell towers (positions + NCC 4G/5G counts, click-to-inspect). */
export function createApplicationTaiwanCellTowers(options) {
  return createTaiwanCellTowersLayer({ overlayHost, ...options });
}
