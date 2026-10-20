// Refreshes spec/openapi.yaml from the published docs, so schema-driven tests stay
// in sync with the contract without hand-editing the spec.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const SPEC_URL = 'https://pages.kartina.tv/middleware/docs/v4/openapi.yaml';
const OUT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'spec', 'openapi.yaml');

const res = await fetch(SPEC_URL);
if (!res.ok) {
  throw new Error(`Failed to fetch ${SPEC_URL}: ${res.status} ${res.statusText}`);
}
const text = await res.text();
// A CDN challenge or maintenance page can come back as 200 too; overwriting the
// spec with it would break every schema check on the next run.
const doc = /** @type {{ openapi?: unknown; components?: { schemas?: unknown } } | null} */ (load(text));
if (!doc?.openapi || !doc?.components?.schemas) {
  throw new Error(`${SPEC_URL} didn't return an OpenAPI document with components.schemas; ${OUT_PATH} left unchanged`);
}
await writeFile(OUT_PATH, text, 'utf8');
console.log(`Wrote ${OUT_PATH} (${text.length} bytes)`);
