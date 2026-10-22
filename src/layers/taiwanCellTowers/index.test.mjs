import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTowerCard,
  towerIndexFromPickId,
  TOWER_PICK_PREFIX,
} from './index.js';

test('pick ids map back to tower indexes and nothing else matches', () => {
  assert.equal(towerIndexFromPickId(`${TOWER_PICK_PREFIX}42`), 42);
  assert.equal(towerIndexFromPickId('bikeshare:42'), -1);
  assert.equal(towerIndexFromPickId(`${TOWER_PICK_PREFIX}x`), -1);
  assert.equal(towerIndexFromPickId(undefined), -1);
});

test('the card shows place, neighbourhood and that county’s NCC figures', () => {
  const stats = {
    period: '115年9月',
    byCounty: {
      臺北市: {
        total: 2000,
        byTech: { '4G': 1200, '5G': 800 },
        byOperator: { 台灣大哥大: 500, 中華電信: 1500 },
      },
    },
  };
  const card = buildTowerCard({
    index: 0,
    lon: 121.50187,
    lat: 25.0441,
    neighborhood: { within: 7, nearestM: 84.6 },
    place: { county: '台北市', district: '中正區' },
    stats,
    pointsAsOf: '2016-05',
  });
  assert.match(card.title, /#1$/);
  assert.equal(card.details[0], '25.04410°N  121.50187°E');
  assert.equal(card.details[1], '台北市 中正區');
  assert.match(card.details[2], /7/);
  assert.match(card.details[2], /85 m/);
  assert.match(card.details[3], /臺北市.*4G 1,200.*5G 800/);
  // Operators largest first.
  assert.match(card.details[4], /^中華電信 1,500 · 台灣大哥大 500$/);
  assert.match(card.details.at(-1), /2016-05/);
});

test('while the place is pending, or unknown, the card says so', () => {
  const base = {
    index: 9,
    lon: 121,
    lat: 24,
    neighborhood: { within: 0, nearestM: null },
  };
  assert.match(
    buildTowerCard({ ...base, placePending: true }).details[1],
    /Looking up/,
  );
  const unknown = buildTowerCard(base);
  assert.match(unknown.details[1], /unavailable/);
  assert.equal(unknown.details.length, 4);
});
