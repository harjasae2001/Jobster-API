'use strict';

const { readdirSync } = require('fs');
const { spawnSync } = require('child_process');
const { join } = require('path');

const directories = ['src/handlers', 'src/lib'];
let failed = false;

for (const directory of directories) {
  for (const file of readdirSync(join(__dirname, '..', directory))) {
    if (!file.endsWith('.js')) continue;
    const relativePath = join(directory, file);
    const result = spawnSync(process.execPath, ['--check', relativePath], {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
    });
    failed ||= result.status !== 0;
  }
}

process.exitCode = failed ? 1 : 0;
