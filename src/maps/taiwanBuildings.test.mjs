import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAIWAN_BUILDING_TILESETS,
  countiesNear,
  tilesetUrl,
  readStoredEnabled,
  TAIWAN_BUILDINGS_STORAGE_KEY,
  isRetryableTileError,
  nlscRetryCallback,
  NLSC_RETRY_ATTEMPTS,
} from './taiwanBuildings.js';

test('Taipei 101 loads the Taipei per-building model first', () => {
  const near = countiesNear(25.0339, 121.5645);
  assert.equal(near[0].key, 'taipei');
  assert.equal(
    tilesetUrl(near[0]),
    'https://3dtiles.nlsc.gov.tw/building/tiles3d/30/tileset.json',
  );
  assert.ok(near.length <= 3);
});

test('far from Taiwan nothing loads', () => {
  assert.deepEqual(countiesNear(35.68, 139.76), []);
  assert.deepEqual(countiesNear(NaN, 121), []);
});

test('every county has a unique key and NLSC id', () => {
  const keys = new Set(TAIWAN_BUILDING_TILESETS.map((e) => e.key));
  const ids = new Set(TAIWAN_BUILDING_TILESETS.map((e) => e.id));
  assert.equal(keys.size, TAIWAN_BUILDING_TILESETS.length);
  assert.equal(ids.size, TAIWAN_BUILDING_TILESETS.length);
});

test('the overlay defaults on and remembers being turned off', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  assert.equal(readStoredEnabled(storage), true);
  storage.setItem(TAIWAN_BUILDINGS_STORAGE_KEY, '0');
  assert.equal(readStoredEnabled(storage), false);
  assert.equal(
    readStoredEnabled({
      getItem() {
        throw new Error('blocked');
      },
    }),
    true,
  );
});

test('spurious NLSC 406s and server errors are retried, real misses are not', async () => {
  assert.ok(NLSC_RETRY_ATTEMPTS >= 3);
  for (const statusCode of [406, 429, 500, 503, undefined, 0])
    assert.equal(
      isRetryableTileError({ statusCode }),
      true,
      String(statusCode),
    );
  for (const statusCode of [400, 403, 404])
    assert.equal(
      isRetryableTileError({ statusCode }),
      false,
      String(statusCode),
    );
  assert.equal(await nlscRetryCallback(null, { statusCode: 406 }), true);
  assert.equal(await nlscRetryCallback(null, { statusCode: 404 }), false);
});
