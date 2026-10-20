import test from 'node:test';
import assert from 'node:assert/strict';
import { taiwanWaterProxy, WRA_DATASETS } from './taiwanWater.js';

const json = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

test('one failing part leaves the others in the snapshot', async () => {
  const fetchImpl = async (url) => {
    if (url.includes(WRA_DATASETS.riverStations))
      return json([
        {
          basinidentifier: 'S1',
          observatoryname: '測站',
          locationbytwd97_xy: '306296 2769951',
        },
      ]);
    if (url.includes(WRA_DATASETS.riverLevels))
      return json([
        { stationid: 'S1', datetime: '2026-10-20T17:30:00', waterlevel: '1.2' },
      ]);
    if (url.includes('sta.colife.org.tw'))
      return new Response('down', { status: 503 });
    return json([]);
  };
  const proxy = taiwanWaterProxy({ fetchImpl });
  const snap = await proxy._snapshot();
  assert.equal(snap.rivers.length, 1);
  assert.equal(snap.floods.length, 0);
  assert.match(snap.errors.join(), /floods: HTTP 503/);
});
