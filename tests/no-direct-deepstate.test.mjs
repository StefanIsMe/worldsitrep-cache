// Policy guard: zero direct DeepStateMap API calls (access denied Sep 2026).
// Forbids the fetchable API path literal anywhere under scripts/, tests/ and
// .github/workflows. Plain deepstatemap.live hyperlinks (attribution,
// license page, map links) remain allowed — only the /api path is banned.
// NOTE: comments must describe the endpoint without the literal (e.g. say
// "the history endpoint"), or this test fails by design.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
// Built at runtime so this file itself stays literal-free.
const banned = 'deepstatemap.live' + '/api';

function files(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(mjs|js|yml|yaml|json|md)$/.test(entry)) out.push(full);
  }
  return out;
}

const hits = [];
for (const dir of ['scripts', 'tests', '.github']) {
  for (const file of files(join(root, dir))) {
    if (readFileSync(file, 'utf8').includes(banned)) hits.push(file);
  }
}
assert.deepEqual(hits, [], `direct DeepState API references must stay out (see README source policy): ${hits.join(', ')}`);
console.log('no direct DeepState API references: OK');
