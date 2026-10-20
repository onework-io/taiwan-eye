import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMotcCctvXml,
  thbRecordToSource,
  nfbRecordToSource,
  nfbJsonRowToRecord,
} from './taiwan.js';
import { fetchMjpegFirstFrame, firstJpegInBuffer } from './media.js';

// Shape of the Highway Bureau's published opendataCCTVs.xml (one record).
const THB_XML = `<CCTVList xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://traffic.transportdata.tw/standard/traffic/schema/">
<UpdateTime>2026-10-20T13:10:20+08:00</UpdateTime><UpdateInterval>86400</UpdateInterval><AuthorityCode>THB</AuthorityCode>
<CCTVs><CCTV><CCTVID>CCTV-14-0620-009-002</CCTVID><SubAuthorityCode>THB-1R</SubAuthorityCode><LinkID>1006200100900C</LinkID>
<VideoStreamURL>https://cctv-ss02.thb.gov.tw:443/T62-9K+020</VideoStreamURL>
<VideoImageURL>https://cctv-ss02.thb.gov.tw:443/T62-9K+020/snapshot</VideoImageURL>
<LocationType>6</LocationType><PositionLon>121.7321</PositionLon><PositionLat>25.10529</PositionLat>
<SurveillanceDescription>快速公路62號(暖暖交流道到大華系統交流道)(W)</SurveillanceDescription>
<RoadID>100620</RoadID><RoadName>台62線</RoadName><RoadClass>1</RoadClass><RoadDirection>W</RoadDirection><LocationMile>9K+020</LocationMile></CCTV>
<CCTV><CCTVID>BAD</CCTVID><VideoImageURL>https://evil.example/x.jpg</VideoImageURL><PositionLon>121.5</PositionLon><PositionLat>25</PositionLat></CCTV>
</CCTVs></CCTVList>`;

test('MOTC v2.0 XML parses into records', () => {
  const rows = parseMotcCctvXml(THB_XML);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'CCTV-14-0620-009-002');
  assert.equal(rows[0].lat, 25.10529);
  assert.equal(rows[0].direction, 'W');
});

test('Highway Bureau cameras register their snapshot; foreign hosts are dropped', () => {
  const [good, bad] = parseMotcCctvXml(THB_XML).map(thbRecordToSource);
  assert.equal(good.id, 'thb-cctv-14-0620-009-002');
  assert.equal(good.feedType, 'image');
  assert.equal(good.url, 'https://cctv-ss02.thb.gov.tw/T62-9K+020/snapshot');
  assert.equal(good.headingDeg, 270);
  assert.equal(bad, null);
});

test('freeway JSON fallback rows become MJPEG-backed stills', () => {
  const record = nfbJsonRowToRecord({
    id: 'CCTV-N1-S-0.000-M',
    stakenumber: '國道1號(基隆端到基隆交流道)',
    gisx: 121.735695,
    gisy: 25.1229931,
    html: 'https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=10000',
  });
  const camera = nfbRecordToSource(record);
  assert.equal(camera.sourceKind, 'nfb-mjpeg');
  assert.equal(camera.headingDeg, 180);
  assert.match(camera.url, /^https:\/\/cctvn\.freeway\.gov\.tw\//);
  assert.equal(
    nfbRecordToSource({ ...record, streamUrl: 'https://x.example/a' }),
    null,
  );
  assert.equal(nfbRecordToSource({ ...record, lat: 40, lon: -74 }), null);
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

test('the first JPEG is cut out of a multipart stream', async () => {
  assert.deepEqual(
    firstJpegInBuffer(Buffer.concat([Buffer.from('--b\r\n\r\n'), JPEG])),
    JPEG,
  );
  const parts = [
    Buffer.from('--myboundary\r\nContent-Type: image/jpeg\r\n\r\n'),
    JPEG.subarray(0, 4),
    JPEG.subarray(4),
    Buffer.from('\r\n--myboundary\r\n'),
  ];
  const body = new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(new Uint8Array(part));
    },
  });
  const frame = await fetchMjpegFirstFrame('https://cctvn.freeway.gov.tw/x', {
    fetchImpl: async () =>
      new Response(body, {
        status: 200,
        headers: {
          'content-type': 'multipart/x-mixed-replace; boundary=myboundary',
        },
      }),
  });
  assert.equal(frame.ok, true);
  assert.equal(frame.contentType, 'image/jpeg');
  assert.deepEqual(frame.body, JPEG);
});

test('a non-image answer yields no frame', async () => {
  const frame = await fetchMjpegFirstFrame('https://cctvn.freeway.gov.tw/x', {
    fetchImpl: async () =>
      new Response('<html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  });
  assert.equal(frame, null);
});
