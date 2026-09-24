// Ukraine zone centers for proposal assignment. Ids MUST match the site's
// public/data/theaters/ukraine/sources/zones.json record ids — the site joins
// proposals to zones by id. If the site adds/renames a zone, update this list
// in the same change. `overall-occupied` is intentionally excluded: it is a
// country rollup, not an assignable oblast.
export const ZONE_CENTERS = [
  { zoneId: 'occ-crimea', region: 'Crimea', lat: 45.3453, lng: 34.4997 },
  { zoneId: 'occ-luhansk', region: 'Luhansk Oblast', lat: 48.574, lng: 39.3078 },
  { zoneId: 'occ-kherson', region: 'Kherson Oblast', lat: 46.6354, lng: 32.6169 },
  { zoneId: 'occ-zaporizhzhia', region: 'Zaporizhzhia Oblast', lat: 47.0, lng: 35.5 },
  { zoneId: 'occ-donetsk', region: 'Donetsk Oblast', lat: 47.8, lng: 37.5 },
  { zoneId: 'occ-kharkiv', region: 'Kharkiv Oblast', lat: 49.8, lng: 37.6 },
  { zoneId: 'lib-kyiv', region: 'Kyiv Oblast', lat: 50.6, lng: 30.2 },
  { zoneId: 'lib-chernihiv', region: 'Chernihiv Oblast', lat: 51.4982, lng: 31.2893 },
  { zoneId: 'lib-sumy', region: 'Sumy Oblast', lat: 50.9077, lng: 34.7981 },
  { zoneId: 'lib-snake', region: 'Snake Island', lat: 45.2551, lng: 30.2033 },
];

/** Nearest zone center (equirectangular degrees — fine for assignment). */
export function nearestZone(lat, lng) {
  let best = null;
  let bestDist = Infinity;
  for (const zone of ZONE_CENTERS) {
    const dLat = lat - zone.lat;
    const dLng = (lng - zone.lng) * Math.cos((zone.lat * Math.PI) / 180);
    const dist = dLat * dLat + dLng * dLng;
    if (dist < bestDist) { bestDist = dist; best = zone; }
  }
  return best;
}
