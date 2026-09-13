import { mkdir, readFile, writeFile } from 'node:fs/promises';
const headers = { accept: 'application/json', 'user-agent': 'WorldSITREP/1.0 (+https://worldsitrep.com)', 'Digitraffic-User': 'WorldSITREP/worldsitrep.com' };
async function json(url) { const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) }); if (!res.ok) throw Error('HTTP ' + res.status); return res.json(); }
async function save(dir, value) { await mkdir(dir, {recursive:true}); await writeFile(dir + '/latest.json', JSON.stringify(value)); }
async function previous(dir) { try { return JSON.parse(await readFile(dir + '/latest.json','utf8')); } catch { return {}; } }
const results = await Promise.allSettled([
  (async () => { const data = await json('https://opensky-network.org/api/states/all'); if (!Array.isArray(data.states) || !Number.isFinite(data.time)) throw Error('Invalid OpenSky envelope'); const prev = await previous('commercial-data');
    const tracks = {};
    for (const s of data.states) {
      if (!/^[0-9a-f]{6}$/i.test(s[0]) || !Number.isFinite(s[3]) || !Number.isFinite(s[5]) || !Number.isFinite(s[6]) || Math.abs(s[5]) > 180 || Math.abs(s[6]) > 90) continue;
      const hex = s[0].toLowerCase(); const seen = new Set();
      tracks[hex] = [...(prev.tracks?.[hex] || []), {lat:s[6], lng:s[5], observedAt:new Date(s[3]*1000).toISOString()}]
        .filter(p => { const age = data.time*1000-Date.parse(p.observedAt); const key=p.observedAt+':'+p.lat+':'+p.lng; if (!Number.isFinite(age) || age < -60000 || age > 86400000 || seen.has(key)) return false; seen.add(key); return true; })
        .sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)).slice(-2000);
    }
    await save('commercial-data', {...data, tracks}); console.log('Commercial states:', data.states.length); })(),
  (async () => {
    const [locations, metadata, prev] = await Promise.all([json('https://meri.digitraffic.fi/api/ais/v1/locations'), json('https://meri.digitraffic.fi/api/ais/v1/vessels'), previous('maritime-data')]);
    if (!Array.isArray(locations.features) || !Array.isArray(metadata)) throw Error('Invalid Digitraffic envelope');
    const names = new Map(metadata.map(v => [String(v.mmsi), v])); const old = new Map((prev.vessels || []).map(v => [v.mmsi, v]));
    const collectedAt = new Date().toISOString(); const vessels = [];
    for (const f of locations.features) {
      const p = f.properties || {}; const c = f.geometry?.coordinates; const mmsi = String(p.mmsi ?? f.mmsi ?? '');
      if (!/^\d{9}$/.test(mmsi) || !Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0])>180 || Math.abs(c[1])>90) continue;
      const ts = Number(p.timestampExternal ?? p.timestamp); const observed = new Date(ts < 1e12 ? ts*1000 : ts); if (!ts || !Number.isFinite(+observed) || Date.now()-observed>12*3600000) continue;
      const observedAt=observed.toISOString(); const info=names.get(mmsi)||{}; const point={lat:c[1],lng:c[0],observedAt};
      const points=[...(old.get(mmsi)?.trackPoints||[]),point]; const seen=new Set(); const trackPoints=points.filter(q=>{ const key=q.observedAt+':'+q.lat+':'+q.lng; if(seen.has(key)||Date.now()-Date.parse(q.observedAt)>24*3600000)return false;seen.add(key);return true;});
      vessels.push({id:'mmsi-'+mmsi,mmsi,shipName:info.name||null,shipType:info.shipType==null?null:String(info.shipType),destination:info.destination||null,...point,telemetry:{sogKnots:p.sog,cogDegrees:p.cog,headingDegrees:p.heading},trackPoints,source:{id:'digitraffic',name:'Fintraffic Digitraffic',url:'https://www.digitraffic.fi/en/marine-traffic/'}});
    }
    if (!vessels.length) throw Error('No valid current vessel positions; retaining previous snapshot');
    await save('maritime-data',{schemaVersion:1,collectedAt,source:{id:'digitraffic',name:'Fintraffic Digitraffic',url:'https://www.digitraffic.fi/en/marine-traffic/'},vessels,count:vessels.length,warnings:['Regional Baltic coverage. Global AISStream collection is separate.']});console.log('Baltic vessels:',vessels.length);
  })()
]);
results.forEach((r,i)=>{if(r.status==='rejected')console.error(['commercial','maritime'][i]+': '+r.reason.message);});
if(results.some(r=>r.status==='rejected'))process.exitCode=1;
