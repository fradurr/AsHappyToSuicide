#!/usr/bin/env node
/**
 * check-data.js — warns before a build made on sample data.
 *
 * Runs automatically before `npm run build`. It does not block: stopping the
 * build would prevent putting up a trial version, which is a legitimate thing
 * to want. But a site showing invented suicide figures because whoever
 * published it forgot is the easiest kind of harm to cause here, so the warning
 * is loud and shows up in the GitHub Actions log too.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const real = path.join(ROOT, 'public', 'data', 'countries.json');
const sample = path.join(ROOT, 'public', 'data', 'countries.placeholder.json');

if (fs.existsSync(real)) {
  const meta = JSON.parse(fs.readFileSync(real, 'utf8')).meta ?? {};
  console.log(`\n  ✓ real data: ${meta.countriesWithData ?? '?'} countries, generated ${meta.generated ?? '?'}\n`);
  if (fs.existsSync(sample)) {
    console.log('  ⚠ public/data/countries.placeholder.json is still there; you can delete it.\n');
  }
} else if (fs.existsSync(sample)) {
  console.log(`
  ┌──────────────────────────────────────────────────────────────────┐
  │  WARNING: building on SAMPLE DATA                                │
  │                                                                  │
  │  public/data/countries.json does not exist, so the site will use │
  │  invented numbers. A black banner on the page says so, but this  │
  │  still publishes false figures about suicide.                    │
  │                                                                  │
  │  For real data:  npm run templates                               │
  │                  (fill them in, then) npm run build:data -- --offline
  └──────────────────────────────────────────────────────────────────┘
`);
} else {
  console.log('\n  ⚠ no data in public/data/: the map will come out empty.\n');
}
