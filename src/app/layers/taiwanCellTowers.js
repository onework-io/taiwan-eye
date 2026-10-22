import { createTaiwanCellTowersLayer } from '../../layers/taiwanCellTowers/index.js';
/** Wire Taiwan cell towers (positions + NCC 4G/5G counts). */
export function createApplicationTaiwanCellTowers(options) {
  return createTaiwanCellTowersLayer(options);
}
