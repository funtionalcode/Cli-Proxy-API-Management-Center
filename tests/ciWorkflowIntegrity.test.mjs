import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = path.join(repoRoot, '.github', 'workflows');
const readWorkflow = (name) => readFileSync(path.join(workflowDir, name), 'utf8');
const dependabotConfig = readFileSync(path.join(repoRoot, '.github', 'dependabot.yml'), 'utf8');

const externalActions = (workflow) =>
  [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)@([^\s#]+)/gm)]
    .map(([, action, ref]) => ({ action, ref }))
    .filter(({ action }) => !action.startsWith('./'));

const jobBlock = (workflow, jobName) => {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start === -1) throw new Error(`Missing workflow job: ${jobName}`);
  const relativeEnd = lines.slice(start + 1).findIndex((line) => /^  \S/.test(line));
  const end = relativeEnd === -1 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start + 1, end).join('\n');
};

describe('GitHub Actions workflow integrity', () => {
  it('pins every external action to a full commit SHA', () => {
    const workflowFiles = readdirSync(workflowDir).filter((file) => /\.ya?ml$/.test(file));
    const actions = workflowFiles.flatMap((file) => externalActions(readWorkflow(file)));

    expect(actions.length).toBeGreaterThan(0);
    for (const { action, ref } of actions) {
      expect(ref, `${action} must be pinned to a 40-character commit SHA`).toMatch(
        /^[0-9a-f]{40}$/
      );
    }
  });

  it('keeps Demo and Docs inside the stable required-check aggregate', () => {
    const workflow = readWorkflow('pr-check.yml');
    const demoJob = jobBlock(workflow, 'demo-docs');
    const requiredJob = jobBlock(workflow, 'required');

    expect(demoJob).toContain('name: Demo and Docs');
    expect(requiredJob).toContain('- demo-docs');
    expect(requiredJob).toContain("DEMO_DOCS_RESULT: ${{ needs['demo-docs'].result }}");
    expect(requiredJob).toContain('"Demo and Docs:${DEMO_DOCS_RESULT}"');
  });

  it('keeps release content validation inside the stable required-check aggregate', () => {
    const workflow = readWorkflow('pr-check.yml');
    const releaseJob = jobBlock(workflow, 'release-content');
    const requiredJob = jobBlock(workflow, 'required');

    expect(releaseJob).toContain('name: Release Content');
    expect(releaseJob).toContain('--changed-content --null');
    expect(releaseJob).toContain('--diff-filter=A -z');
    expect(requiredJob).toContain('- release-content');
    expect(requiredJob).toContain("RELEASE_CONTENT_RESULT: ${{ needs['release-content'].result }}");
    expect(requiredJob).toContain('"Release Content:${RELEASE_CONTENT_RESULT}"');
  });

  it('uses NUL-delimited Git paths before classification and release validation', () => {
    const workflow = readWorkflow('pr-check.yml');

    expect(workflow).toContain('git diff --name-only --no-renames -z');
    expect(workflow).toContain('git show --pretty=format: --name-only --no-renames -z');
    expect(workflow).toContain('classify-pr-checks.mjs --null');
  });

  it('serializes every publishing stage behind release preflight', () => {
    const workflow = readWorkflow('release.yml');
    for (const jobName of [
      'build_release_assets',
      'build_and_push_docker',
      'publish_github_release',
      'notify_telegram',
    ]) {
      const job = jobBlock(workflow, jobName);
      expect(
        /needs:\s*preflight|needs:[\s\S]*?\n\s+- preflight/.test(job),
        `${jobName} must depend on preflight`
      ).toBe(true);
    }
  });

  it('exposes a serialized dry-run path and rejects legacy release-note fallback', () => {
    const workflow = readWorkflow('release.yml');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('version:');
    expect(workflow).toContain('dry_run=true');
    expect(workflow).toContain(
      "import { parseReleaseTag } from './bin/release/validate-release.mjs'"
    );
    expect(workflow).toContain('group: release-publish');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).not.toContain('Generate release notes');
    expect(workflow).not.toContain('git log --pretty');
    expect(workflow).not.toContain('previous_tag');
  });

  it('scopes Telegram secrets to the delivery step', () => {
    const workflow = readWorkflow('release.yml');
    const notifyJob = jobBlock(workflow, 'notify_telegram');
    const stepsOffset = notifyJob.indexOf('\n    steps:');
    const jobConfiguration = notifyJob.slice(0, stepsOffset);
    const deliveryStep = notifyJob.slice(notifyJob.indexOf('- name: Send Telegram'));

    expect(jobConfiguration).not.toContain('TELEGRAM_BOT_TOKEN');
    expect(jobConfiguration).not.toContain('TELEGRAM_CHAT_ID');
    expect(deliveryStep).toContain('TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}');
    expect(deliveryStep).toContain('TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}');
  });

  it('does not retain the main-only standalone Demo and Docs workflow', () => {
    expect(existsSync(path.join(workflowDir, 'demo-docs-check.yml'))).toBe(false);
  });

  it('keeps GitHub Actions dependency updates on the integration branch', () => {
    expect(dependabotConfig).toContain('package-ecosystem: github-actions');
    expect(dependabotConfig).toContain('target-branch: dev');
    expect(dependabotConfig).toContain('interval: weekly');
  });
});
