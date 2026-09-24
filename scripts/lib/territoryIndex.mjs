// Territory day-index helper — scans territory-daily/days/YYYY/MM/DD.json
// and builds the sorted date list the site's timeline scrubber consumes.
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** List available snapshot days (ascending) under a days/ directory. */
export async function listSnapshotDays(daysDir) {
  const days = [];
  let years;
  try {
    years = await readdir(daysDir);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  for (const year of years.filter((d) => /^\d{4}$/.test(d)).sort()) {
    let months;
    try {
      months = await readdir(resolve(daysDir, year));
    } catch {
      continue;
    }
    for (const month of months.filter((d) => /^\d{2}$/.test(d)).sort()) {
      let files;
      try {
        files = await readdir(resolve(daysDir, year, month));
      } catch {
        continue;
      }
      for (const file of files.filter((f) => /^\d{2}\.json$/.test(f)).sort()) {
        const day = `${year}-${month}-${file.slice(0, 2)}`;
        if (DAY_RE.test(day) && Number.isFinite(Date.parse(day))) days.push(day);
      }
    }
  }
  return days;
}

/** Build the index.json payload for a days/ directory. */
export async function buildDayIndex(daysDir, { updatedAt = new Date().toISOString() } = {}) {
  const days = await listSnapshotDays(daysDir);
  return {
    schemaVersion: 1,
    theatreId: 'ukraine',
    updatedAt,
    days,
    coverage: days.length
      ? { first: days[0], last: days[days.length - 1], count: days.length }
      : { first: null, last: null, count: 0 },
  };
}
