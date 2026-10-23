// `npm run report`: opens test-results/latest.html with the OS default opener.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const path = 'test-results/latest.html';
if (!existsSync(path)) {
  console.error(`No report at ${path} yet: run the tests first (npm test). Playwright also clears test-results/ when a new run starts.`);
  process.exit(1);
}
const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
const args = process.platform === 'win32' ? ['', path] : [path];

spawn(command, args, { shell: process.platform === 'win32', stdio: 'ignore', detached: true }).unref();
