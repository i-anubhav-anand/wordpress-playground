/**
 * Vitest setup for kernel-mode specs. Sets KANDELO_DIR to the in-repo
 * kandelo submodule when its `host/dist/index.js` exists (built locally
 * or fetched in CI), unless the caller already pinned it.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const submoduleDir = resolve(here, '../../../../../kandelo');
const submoduleHostEntry = resolve(submoduleDir, 'host', 'dist', 'index.js');

if (!process.env['KANDELO_DIR'] && existsSync(submoduleHostEntry)) {
	process.env['KANDELO_DIR'] = submoduleDir;
}
