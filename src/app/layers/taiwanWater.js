import { createTaiwanWaterLayer } from '../../layers/taiwanWater/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire Taiwan water (river levels, flood sensors, reservoirs). */
export function createApplicationTaiwanWater(options) {
  return createTaiwanWaterLayer({ overlayHost, ...options });
}
