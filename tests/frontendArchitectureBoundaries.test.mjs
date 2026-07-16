import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repoRoot, 'apps/web/src');
const checkedRoots = ['features', 'components'];
const sourceExtensions = new Set(['.ts', '.tsx']);

const walkFiles = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const filePath = path.join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) return walkFiles(filePath);
    return [filePath];
  });

describe('frontend architecture boundaries', () => {
  it('keeps feature and business component code from importing pages', () => {
    const offenders = checkedRoots
      .flatMap((root) => walkFiles(path.join(sourceRoot, root)))
      .filter((filePath) => sourceExtensions.has(path.extname(filePath)))
      .filter((filePath) => readFileSync(filePath, 'utf8').includes('@/pages'))
      .map((filePath) => path.relative(repoRoot, filePath));

    expect(offenders).toEqual([]);
  });
});
