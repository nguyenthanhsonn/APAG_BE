const { cpSync, existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const source = join(__dirname, '..', 'assets');
const target = join(__dirname, '..', 'dist', 'assets');

if (!existsSync(source)) {
  process.exit(0);
}

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
