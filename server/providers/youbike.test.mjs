import test from 'node:test';
import assert from 'node:assert/strict';
import {
  youbikeToGbfs,
  parseYoubikePath,
  taipeiTimeToEpoch,
  fetchYoubikeGbfs,
} from './youbike.js';

const ROW = {
  sno: '500101001',
  sna: 'YouBike2.0_捷運科技大樓站',
  sarea: '大安區',
  mday: '2026-10-20 07:51:02',
  ar: '復興南路二段235號前',
  snaen: 'YouBike2.0_MRT Technology Bldg. Sta.',
  act: '1',
  srcUpdateTime: '2026-10-20 07:51:52',
  Quantity: 28,
  available_rent_bikes: 2,
  latitude: 25.02605,
  longitude: 121.5436,
  available_return_bikes: 26,
};

test('Taipei local time reads as UTC+8', () => {
  assert.equal(
    taipeiTimeToEpoch('2026-10-20 08:00:00'),
    Date.UTC(2026, 9, 20, 0, 0, 0) / 1000,
  );
});

test('a YouBike row becomes GBFS station_information and station_status', () => {
  const info = youbikeToGbfs([ROW], 'station_information', 0);
  assert.deepEqual(info.data.stations[0], {
    station_id: '500101001',
    name: '捷運科技大樓站',
    lat: 25.02605,
    lon: 121.5436,
    address: '復興南路二段235號前',
    capacity: 28,
  });
  const status = youbikeToGbfs([ROW], 'station_status', 0);
  assert.equal(status.data.stations[0].num_bikes_available, 2);
  assert.equal(status.data.stations[0].num_docks_available, 26);
  assert.equal(status.data.stations[0].is_renting, true);
});

test('rows without coordinates are dropped', () => {
  const out = youbikeToGbfs([{ sno: '1' }], 'station_status', 0);
  assert.equal(out.data.stations.length, 0);
});

test('only known cities and GBFS paths resolve', () => {
  assert.deepEqual(parseYoubikePath('/taipei/station_status.json'), {
    city: 'taipei',
    kind: 'station_status',
  });
  assert.equal(parseYoubikePath('/nowhere/station_status.json'), null);
  assert.equal(parseYoubikePath('/taipei/../etc'), null);
});

test('the adapter fetches the fixed upstream once and serves GBFS', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify([ROW]), { status: 200 });
  };
  const res = await fetchYoubikeGbfs('/taipei/station_information.json', {
    fetchImpl,
  });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).data.stations.length, 1);
  assert.match(calls[0], /tcgbusfs\.blob\.core\.windows\.net/);
});
