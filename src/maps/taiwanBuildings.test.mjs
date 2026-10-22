import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAIWAN_BUILDING_TILESETS,
  countiesNear,
  tilesetUrl,
  readStoredEnabled,
  TAIWAN_BUILDINGS_STORAGE_KEY,
  installNlscRetry,
  isRetryableTileError,
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

function fakeResource(statuses) {
  const calls = [];
  const Resource = {
    _Implementations: {
      loadWithXhr(url, type, method, data, headers, deferred) {
        calls.push(url);
        const status = statuses.shift();
        queueMicrotask(() =>
          status === 200
            ? deferred.resolve('ok')
            : deferred.reject({ statusCode: status }),
        );
        return { abort() {} };
      },
    },
  };
  installNlscRetry(Resource, { delay: () => 0 });
  installNlscRetry(Resource, { delay: () => 0 }); // idempotent
  const load = (url) =>
    new Promise((resolve, reject) =>
      Resource._Implementations.loadWithXhr(
        url,
        'arraybuffer',
        'GET',
        null,
        {},
        {
          resolve,
          reject,
        },
      ),
    );
  return { calls, load };
}

test('NLSC 406s are retried inside the one granted request', async () => {
  const { calls, load } = fakeResource([406, 406, 200]);
  assert.equal(
    await load('https://3dtiles.nlsc.gov.tw/building/tiles3d/30/a.glb'),
    'ok',
  );
  assert.equal(calls.length, 3);
});

test('other hosts and real 404s are not retried', async () => {
  const other = fakeResource([406, 200]);
  await assert.rejects(other.load('https://example.com/a.glb'));
  assert.equal(other.calls.length, 1);
  const missing = fakeResource([404, 200]);
  await assert.rejects(missing.load('https://3dtiles.nlsc.gov.tw/x.glb'));
  assert.equal(missing.calls.length, 1);
  assert.equal(isRetryableTileError({ statusCode: 503 }), true);
  assert.equal(isRetryableTileError({ statusCode: 403 }), false);
});
