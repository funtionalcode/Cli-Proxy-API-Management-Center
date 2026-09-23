import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(path.join(repoRoot, '.github', 'workflows', 'pr-check.yml'), 'utf8');

const jobBlock = (jobName) => {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start === -1) throw new Error(`Missing workflow job: ${jobName}`);
  const relativeEnd = lines.slice(start + 1).findIndex((line) => /^  \S/.test(line));
  const end = relativeEnd === -1 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start + 1, end).join('\n');
};

describe('release contributor workflow contract', () => {
  it('gives Release Content only the read permissions needed to resolve PR authors', () => {
    const job = jobBlock('release-content');
    expect(job).toContain('contents: read');
    expect(job).toContain('pull-requests: read');
    expect(job).not.toContain('contents: write');
    expect(job).not.toContain('pull-requests: write');
  });

  it('validates external contributors only on the release PR into dev', () => {
    const job = jobBlock('release-content');
    expect(job).toContain('fetch-tags: true');
    expect(job).toContain('PR_BASE_REF: ${{ github.event.pull_request.base.ref }}');
    expect(job).toContain('[ "${PR_BASE_REF}" = "dev" ]');
    expect(job).toContain('bin/release/validate-release-contributors.mjs');
    expect(job).toContain('--source-sha "${PR_BASE_SHA}"');
    expect(job).toContain("jq -r '.tags[]'");
  });
});
