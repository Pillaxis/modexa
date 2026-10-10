import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

// Check every first-party browser module, including newly extracted modules.
for (const name of await readdir(new URL('../dist/', import.meta.url))) {
  if (!name.endsWith('.js')) continue;
  const file = new URL('../dist/' + name, import.meta.url);
  const {fileURLToPath} = await import('node:url');
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(file)], {stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
