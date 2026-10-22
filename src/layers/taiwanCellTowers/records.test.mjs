import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTowerScript,
  periodRank,
  summarizeNccStats,
  readCellSnapshot,
  towerNeighborhood,
  normalizeCounty,
} from './records.js';

test('the community tower script parses to de-duplicated Taiwan points', () => {
  const script = `var data = {
"icons":
[
  { "longitude":121.501873, "latitude":25.044104 },
  { "longitude":121.501873, "latitude":25.044104 },
  { "longitude":120.48606, "latitude":22.6835 },
  { "longitude":0, "latitude":0 }
]}`;
  assert.deepEqual(
    parseTowerScript(script),
    [121.50187, 25.0441, 120.48606, 22.6835],
  );
  assert.throws(() => parseTowerScript('nothing here'), /Malformed/);
});

test('NCC periods sort across ROC, compact and Gregorian forms', () => {
  assert.ok(periodRank('115年9月') > periodRank('115年8月'));
  assert.equal(periodRank('115年9月'), periodRank('2026/09'));
  assert.equal(periodRank('11509'), 11509);
  assert.equal(periodRank(''), -1);
});

test('NCC statistics keep only the latest period and skip roll-up rows', () => {
  const summary = summarizeNccStats([
    {
      縣市: '臺北市',
      統計期: '115年8月',
      業者名稱: '中華電信',
      類別: '4G',
      基地臺: '9',
    },
    {
      縣市: '臺北市',
      統計期: '115年9月',
      業者名稱: '中華電信',
      類別: '4G',
      基地臺: '1,200',
    },
    {
      縣市: '臺北市',
      統計期: '115年9月',
      業者名稱: '中華電信',
      類別: '5G',
      基地臺: '800',
    },
    {
      縣市: '新北市',
      統計期: '115年9月',
      業者名稱: '台灣大哥大',
      類別: '5G',
      基地臺: 300,
    },
    {
      縣市: '總計',
      統計期: '115年9月',
      業者名稱: '中華電信',
      類別: '4G',
      基地臺: 99999,
    },
  ]);
  assert.equal(summary.period, '115年9月');
  assert.deepEqual(summary.byTech, { '4G': 1200, '5G': 1100 });
  assert.deepEqual(summary.byOperator, { 中華電信: 2000, 台灣大哥大: 300 });
  assert.equal(summary.total, 2300);
  // Per-county breakdown, keyed by the 臺 spelling OSM and NCC both map to.
  assert.deepEqual(summary.byCounty['臺北市'], {
    total: 2000,
    byTech: { '4G': 1200, '5G': 800 },
    byOperator: { 中華電信: 2000 },
  });
  assert.equal(summary.byCounty['新北市'].byTech['5G'], 300);
  // A wrapped payload works too, and nothing usable is null.
  assert.equal(
    summarizeNccStats({ data: [{ 統計期: '115年9月', 類別: '4G', 基地臺: 5 }] })
      .total,
    5,
  );
  assert.equal(summarizeNccStats({ data: [] }), null);
});

test('the browser drops malformed points and keeps the stats', () => {
  const snap = readCellSnapshot({
    points: [121.5, 25.0, 'x', 1, 0, 0],
    pointsAsOf: '2016-05',
    stats: { period: '115年9月' },
    errors: ['stats: HTTP 503'],
  });
  assert.deepEqual(snap.points, [121.5, 25.0]);
  assert.equal(snap.pointsAsOf, '2016-05');
  assert.equal(snap.stats.period, '115年9月');
  assert.deepEqual(snap.errors, ['stats: HTTP 503']);
});

test('county names normalise 台 to 臺', () => {
  assert.equal(normalizeCounty(' 台北市 '), '臺北市');
  assert.equal(normalizeCounty('臺中市'), '臺中市');
});

test('a tower neighbourhood counts sites in range and finds the nearest', () => {
  // ~111 m and ~333 m north of the first site, and one ~2.2 km away.
  const points = [121.5, 25.0, 121.5, 25.001, 121.5, 25.003, 121.5, 25.02];
  const near = towerNeighborhood(points, 0, 500);
  assert.equal(near.within, 2);
  assert.ok(Math.abs(near.nearestM - 111.3) < 1, String(near.nearestM));
  assert.equal(towerNeighborhood([121.5, 25.0], 0, 500).nearestM, null);
});
