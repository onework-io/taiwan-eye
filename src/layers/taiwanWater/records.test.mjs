import test from 'node:test';
import assert from 'node:assert/strict';
import {
  twd97ToWgs84,
  joinRiverLevels,
  joinReservoirs,
  normalizeFloodDatastream,
  riverStatus,
  taiwanTimeToMs,
  readWaterSnapshot,
} from './records.js';

test('TWD97 TM2 converts to WGS84 near Taipei', () => {
  // A point in Xinyi District; checked against the known TM2 grid there.
  const p = twd97ToWgs84(306296, 2769951);
  assert.ok(Math.abs(p.lat - 25.0366) < 0.001, p.lat);
  assert.ok(Math.abs(p.lon - 121.5579) < 0.001, p.lon);
  assert.equal(twd97ToWgs84(NaN, 1), null);
});

test('Taiwan local times without a zone are read as UTC+8', () => {
  assert.equal(
    taiwanTimeToMs('2026-10-20T17:30:00'),
    Date.UTC(2026, 9, 20, 9, 30),
  );
  assert.equal(
    taiwanTimeToMs('2026-10-20T17:30:03+08:00'),
    Date.UTC(2026, 9, 20, 9, 30, 3),
  );
});

test('WRA numbers alert level 1 as the most severe', () => {
  const alerts = { alert1: 5.8, alert2: 4.6, alert3: 3.5 };
  assert.equal(riverStatus(6, alerts).key, 'danger');
  assert.equal(riverStatus(5, alerts).key, 'warning');
  assert.equal(riverStatus(4, alerts).key, 'watch');
  assert.equal(riverStatus(1, alerts).key, 'normal');
  assert.equal(riverStatus(NaN, alerts).key, 'unknown');
});

test('river stations join their newest level; decommissioned ones drop', () => {
  const stations = [
    {
      basinidentifier: '1010H006',
      observatoryname: '五堵',
      rivername: '基隆河',
      locationbytwd97_xy: '310928.30 2790168.45',
      alertlevel1: '5.8',
      alertlevel2: '4.6',
      observationstatus: '現存',
    },
    {
      basinidentifier: '1010H001',
      observatoryname: '金山',
      locationbytwd97_xy: '310928.30 2790168.45',
      observationstatus: '已廢',
    },
  ];
  const levels = [
    {
      stationid: '1010H006',
      datetime: '2026-10-20T17:20:00',
      waterlevel: '1.70',
    },
    {
      stationid: '1010H006',
      datetime: '2026-10-20T17:30:00',
      waterlevel: '4.83',
    },
    {
      stationid: '1010H001',
      datetime: '2026-10-20T17:30:00',
      waterlevel: '1.00',
    },
  ];
  const rivers = joinRiverLevels(stations, levels);
  assert.equal(rivers.length, 1);
  assert.equal(rivers[0].value, 4.83);
  assert.equal(rivers[0].status, 'warning');
  assert.equal(rivers[0].river, '基隆河');
});

test('reservoirs are placed by name and joined by identifier', () => {
  const out = joinReservoirs(
    [
      {
        reservoiridentifier: '10201',
        reservoirname: '石門水庫',
        datetime: '2026-10-19T00:00:00',
        inflow: '50',
      },
      {
        reservoiridentifier: '10802',
        reservoirname: '羅東攔河堰',
        datetime: '2026-10-19T00:00:00',
      },
    ],
    [
      {
        reservoiridentifier: '10201',
        observationtime: '2026-10-20T08:00:00',
        waterlevel: '240.1',
        effectivewaterstoragecapacity: '18000',
      },
    ],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].name, '石門水庫');
  assert.equal(out[0].value, 240.1);
  assert.equal(out[0].storage, 18000);
});

test('a SensorThings flood datastream becomes a sensor record', () => {
  const record = normalizeFloodDatastream({
    '@iot.id': 9,
    unitOfMeasurement: { symbol: 'cm' },
    Thing: {
      name: '淹水感測器',
      properties: { stationID: 'abc', stationName: '中正路口' },
      Locations: [{ location: { type: 'Point', coordinates: [121.5, 25.05] } }],
    },
    Observations: [{ phenomenonTime: '2026-10-20T09:00:00Z', result: 12 }],
  });
  assert.equal(record.id, 'abc');
  assert.equal(record.status, 'flooded');
  assert.equal(record.value, 12);
  assert.equal(normalizeFloodDatastream({ Thing: {} }), null);
});

test('the client drops records without a position', () => {
  const snap = readWaterSnapshot({
    rivers: [{ id: 'a', lat: 25, lon: 121 }, { id: 'b' }],
    floods: 'nope',
  });
  assert.equal(snap.rivers.length, 1);
  assert.deepEqual(snap.floods, []);
});
