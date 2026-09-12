import { mkdir, readFile, writeFile } from 'node:fs/promises';
// Credentials remain in Actions secrets. Only normalized public broadcasts are published.
const key = process.env.AISSTREAM_API_KEY;
if (!key) { console.log('Global AIS not configured; retaining the dated snapshot.'); process.exit(0); }
const path = 'global-vessel-data/latest.json';
let previous = {};
try { previous = JSON.parse(await readFile(path, 'utf8')); } catch {}
const vessels = new Map((previous.vessels || []).map(v => [v.mmsi, v]));
const socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
socket.binaryType = 'arraybuffer';
let fixes = 0;
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.close(); fixes ? resolve() : reject(Error('No AIS positions received; snapshot retained')); }, 65000);
  socket.addEventListener('error', () => { clearTimeout(timer); socket.close(); reject(Error('AIS connection failed')); });
  socket.addEventListener('open', () => socket.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[-90,-180],[90,180]]], FilterMessageTypes: ['PositionReport','StandardClassBPositionReport','ShipStaticData'] })));
  socket.addEventListener('message', event => {
    try {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
      const meta = msg.MetaData || {}; const mmsi = String(meta.MMSI || ''); if (!/^\d{9}$/.test(mmsi)) return;
      const old = vessels.get(mmsi) || {id:'mmsi-'+mmsi,mmsi,trackPoints:[]};
      const stat = msg.Message?.ShipStaticData;
      if (stat) { vessels.set(mmsi, {...old, shipName:stat.ShipName?.trim() || old.shipName,shipType:stat.Type == null ? old.shipType : String(stat.Type),destination:stat.Destination?.trim() || old.destination}); return; }
      const pos = msg.Message?.PositionReport || msg.Message?.StandardClassBPositionReport;
      if (!pos) return;
      const lat=pos.Latitude ?? meta.latitude ?? meta.Latitude; const lng=pos.Longitude ?? meta.longitude ?? meta.Longitude;
      const observedAt = new Date(meta.time_utc).toISOString();
      if (!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180) return;
      const point={lat,lng,observedAt}; const trackPoints=[...(old.trackPoints||[]),point].filter(p=>Date.now()-Date.parse(p.observedAt)<24*3600000);
      vessels.set(mmsi,{...old,...point,shipName:meta.ShipName?.trim()||old.shipName,telemetry:{sogKnots:pos.Sog,cogDegrees:pos.Cog,headingDegrees:pos.TrueHeading ?? pos.Heading},trackPoints,source:{id:'aisstream',name:'AISStream',url:'https://aisstream.io'}}); fixes++;
    } catch {}
  });
});
const current=[...vessels.values()].filter(v=>Number.isFinite(v.lat)&&Number.isFinite(v.lng)&&Date.now()-Date.parse(v.observedAt)<12*3600000);
await mkdir('global-vessel-data',{recursive:true});
await writeFile(path,JSON.stringify({schemaVersion:1,collectedAt:new Date().toISOString(),source:{id:'aisstream',name:'AISStream',url:'https://aisstream.io'},count:current.length,vessels:current,warnings:['Sampled broadcast coverage; silence does not indicate absence.']}));
console.log('Global AIS vessels:',current.length);
