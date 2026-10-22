import test from 'node:test';
import assert from 'node:assert/strict';
import {
  taiwanCellTowersProxy,
  TOWER_POSITIONS_URL,
  NCC_STATS_URL,
} from './taiwanCellTowers.js';

test('a failing NCC download still serves the tower positions', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url === TOWER_POSITIONS_URL)
      return new Response(
        'var data = { "icons": [ { "longitude": 121.5, "latitude": 25.04 } ] }',
        { status: 200 },
      );
    return new Response('down', { status: 503 });
  };
  const snap = await taiwanCellTowersProxy({ fetchImpl })._snapshot();
  assert.deepEqual(snap.points, [121.5, 25.04]);
  assert.equal(snap.pointsAsOf, '2016-05');
  assert.equal(snap.stats, null);
  assert.match(snap.errors.join(), /stats: HTTP 503/);
  assert.ok(urls.includes(NCC_STATS_URL));
  assert.match(NCC_STATS_URL, /^https:\/\/api\.ncc\.gov\.tw\/uploaddowndoc\?/);
});

test('fresh parts are served from cache', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (url === TOWER_POSITIONS_URL)
      return new Response(
        'var data = {"icons":[{"longitude":121,"latitude":24}]}',
      );
    return new Response(
      JSON.stringify([
        { 統計期: '115年9月', 類別: '5G', 業者名稱: 'A', 縣市: 'X', 基地臺: 3 },
      ]),
    );
  };
  const proxy = taiwanCellTowersProxy({ fetchImpl });
  await proxy._snapshot();
  const second = await proxy._snapshot();
  assert.equal(calls, 2);
  assert.equal(second.stats.byTech['5G'], 3);
});
