import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  ReleaseError,
  parseGhApiResponse,
  admitBranchRef,
  admitTag,
  compareVersions,
  computeNextVersion,
  decideNextCleanup,
  extractReleaseNotes,
  planFinalization,
  planPublishTag,
  selectCiRun,
} from './lib.mjs';
import { getVersionState } from './registry.mjs';
import { main } from './cli.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const REPO = 'Takazudo/zudo-design-token-lint';
const pkg = (version) => ({ name: PACKAGE_NAME, version });
const enc = PACKAGE_NAME.replace('/', '%2f');

function provenance(commit) {
  const stmt = {
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            ref: 'refs/tags/v2.2.0',
            path: '.github/workflows/publish.yml',
            repository: 'https://github.com/Takazudo/zudo-design-token-lint',
          },
        },
        resolvedDependencies: [{ digest: { gitCommit: commit } }],
      },
    },
  };
  return {
    attestations: [
      {
        predicateType: 'https://slsa.dev/provenance/v1',
        bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(stmt)).toString('base64') } },
      },
    ],
  };
}

// routes: { [urlSuffix]: Array<response> | response }, response = { status, json } | Error
function fakeDeps({
  routes = {},
  exec = () => ({ code: 0, stdout: '', stderr: '' }),
  files = {},
  env = {},
} = {}) {
  const calls = [];
  const outputs = {};
  const lines = [];
  const queues = Object.fromEntries(
    Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]),
  );
  return {
    calls,
    outputs,
    lines,
    deps: {
      async fetch(url) {
        calls.push(['fetch', url]);
        const key = Object.keys(queues).find((k) => url.endsWith(k));
        if (!key) throw new Error(`unrouted ${url}`);
        const q = queues[key];
        const r = q.length > 1 ? q.shift() : q[0];
        if (r instanceof Error) throw r;
        return { status: r.status, json: async () => r.json };
      },
      sleep: async () => {},
      exec(cmd, args, opts) {
        calls.push([cmd, ...args]);
        return exec(cmd, args, opts);
      },
      env: { GITHUB_OUTPUT: 'OUT', ...env },
      readFile(p) {
        if (!(p in files)) throw new Error(`ENOENT ${p}`);
        return files[p];
      },
      writeFile(p, s) {
        files[p] = s;
      },
      appendFile(p, s) {
        if (p !== 'OUT') return;
        const [k, ...v] = s.trimEnd().split('=');
        outputs[k] = v.join('=');
      },
      out: (s) => lines.push(s),
      err: (s) => lines.push(s),
      nodeVersion: '22.14.0',
    },
  };
}

const isMutation = (c) =>
  (c[0] === 'gh' && (c.includes('POST') || c.includes('create') || c.includes('edit'))) ||
  (c[0] === 'npm' && (c[1] === 'publish' || c[1] === 'dist-tag')) ||
  (c[0] === 'git' && ['push', 'tag'].includes(c[1]));

describe('tag admission', () => {
  it('admits exact stable and prerelease tags matching package.json', () => {
    expect(admitTag({ tag: 'v2.2.0', packageJson: pkg('2.2.0') })).toMatchObject({
      channel: 'latest',
    });
    expect(admitTag({ tag: 'v2.2.0-next.1', packageJson: pkg('2.2.0-next.1') })).toMatchObject({
      channel: 'next',
      prerelease: true,
    });
  });

  it.each([
    'v2.2.0-foo',
    'v2.2.0-next',
    'v2.2.0-next.01',
    'v02.2.0',
    'v2.2',
    '2.2.0',
    'v2.2.0+build',
    'v2.2.0-alpha.1',
    'refs/tags/v2.2.0',
    'v2.2.0 ',
  ])('refuses %s (old prefix-only check accepted several of these)', (tag) => {
    expect(() => admitTag({ tag, packageJson: pkg(tag.replace(/^v/, '')) })).toThrow(
      /not an allowed release tag/,
    );
  });

  it('refuses tag/package.json version mismatch', () => {
    expect(() => admitTag({ tag: 'v2.2.0', packageJson: pkg('2.1.0') })).toThrow(ReleaseError);
  });

  it('refuses a different package name', () => {
    expect(() =>
      admitTag({ tag: 'v2.2.0', packageJson: { name: 'evil', version: '2.2.0' } }),
    ).toThrow(/is not @takazudo/);
  });
});

describe('branch refusal', () => {
  it('only main may start a release', () => {
    expect(admitBranchRef('refs/heads/main')).toBe(true);
    for (const ref of ['refs/heads/feature', 'refs/tags/v2.2.0', 'refs/heads/main2', 'main']) {
      expect(() => admitBranchRef(ref)).toThrow(/must run from refs\/heads\/main/);
    }
  });
});

describe('CI admission', () => {
  const run = (o) => ({
    id: 1,
    head_sha: SHA,
    event: 'push',
    head_branch: 'main',
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    html_url: 'u',
    ...o,
  });

  it('records exact run id and attempt for the SHA', () => {
    expect(selectCiRun([run({ id: 7, run_attempt: 2 })], SHA)).toMatchObject({
      status: 'admitted',
      runId: 7,
      attempt: 2,
    });
  });

  it('ignores other SHAs, PR events and other branches', () => {
    const runs = [
      run({ head_sha: OTHER }),
      run({ event: 'pull_request' }),
      run({ head_branch: 'feat' }),
    ];
    expect(selectCiRun(runs, SHA).status).toBe('missing');
  });

  it('pending while in progress; refused when only failures exist', () => {
    expect(selectCiRun([run({ status: 'in_progress', conclusion: null })], SHA).status).toBe(
      'pending',
    );
    expect(selectCiRun([run({ conclusion: 'failure' })], SHA)).toMatchObject({
      status: 'refused',
      conclusion: 'failure',
    });
  });

  it('admit-ci waits boundedly, then fails', async () => {
    const f = fakeDeps({
      exec: () => ({ code: 0, stdout: JSON.stringify({ workflow_runs: [] }), stderr: '' }),
    });
    const code = await main(['admit-ci', '--sha', SHA, '--repo', REPO, '--tries', '3'], f.deps);
    expect(code).toBe(1);
    expect(f.calls.filter((c) => c[0] === 'gh')).toHaveLength(3);
  });
});

describe('source admission', () => {
  it('refuses a commit not on origin/main', async () => {
    const f = fakeDeps({
      exec: (cmd, args) =>
        args[0] === 'merge-base'
          ? { code: 1, stdout: '', stderr: '' }
          : { code: 0, stdout: SHA, stderr: '' },
    });
    expect(await main(['admit-source', '--sha', SHA], f.deps)).toBe(1);
    expect(f.lines.join('\n')).toMatch(/not-on-main/);
  });

  it('refuses when the tag resolves to another commit', async () => {
    const f = fakeDeps({ exec: () => ({ code: 0, stdout: OTHER, stderr: '' }) });
    expect(await main(['admit-source', '--sha', SHA, '--tag', 'v2.2.0'], f.deps)).toBe(1);
    expect(f.lines.join('\n')).toMatch(/tag-moved/);
  });

  it('refuses a short / non-hex sha', async () => {
    const f = fakeDeps();
    expect(await main(['admit-source', '--sha', 'abc123'], f.deps)).toBe(1);
  });
});

describe('registry state', () => {
  it('distinguishes published, absent and unknown', async () => {
    const ok = fakeDeps({
      routes: { [`${enc}/2.2.0`]: { status: 200, json: { version: '2.2.0' } } },
    });
    expect((await getVersionState(PACKAGE_NAME, '2.2.0', ok.deps)).state).toBe('published');
    const no = fakeDeps({ routes: { [`${enc}/2.2.0`]: { status: 404 } } });
    expect((await getVersionState(PACKAGE_NAME, '2.2.0', no.deps)).state).toBe('absent');
  });

  it('transport errors are unknown (never absent), bounded, original errors preserved', async () => {
    const f = fakeDeps({
      routes: {
        [`${enc}/2.2.0`]: [
          new Error('ECONNRESET first'),
          { status: 503 },
          { status: 502 },
          new Error('ETIMEDOUT last'),
        ],
      },
    });
    const r = await getVersionState(PACKAGE_NAME, '2.2.0', f.deps);
    expect(r.state).toBe('unknown');
    expect(r.error).toMatch(/ECONNRESET first/);
    expect(r.error).toMatch(/ETIMEDOUT last/);
    expect(f.calls.filter((c) => c[0] === 'fetch')).toHaveLength(4);
  });

  it('registry-state fails the step on unknown', async () => {
    const f = fakeDeps({ routes: { [`${enc}/2.2.0`]: { status: 500 } } });
    expect(await main(['registry-state', '--version', '2.2.0'], f.deps)).toBe(1);
    expect(f.outputs.registry_state).toBe('unknown');
  });
});

describe('existing publication', () => {
  const route = (json, status = 200) => ({ [`attestations/${enc}@2.2.0`]: { status, json } });

  it('accepted only when provenance names the same commit', async () => {
    const f = fakeDeps({ routes: route(provenance(SHA)) });
    expect(
      await main(['verify-published', '--repo', REPO, '--version', '2.2.0', '--sha', SHA], f.deps),
    ).toBe(0);
  });

  it('refuses a publication built from a different commit', async () => {
    const f = fakeDeps({ routes: route(provenance(OTHER)) });
    expect(
      await main(['verify-published', '--repo', REPO, '--version', '2.2.0', '--sha', SHA], f.deps),
    ).toBe(1);
    expect(f.lines.join('\n')).toMatch(/conflicting-publication/);
  });

  it('refuses when provenance cannot be read (bounded)', async () => {
    const f = fakeDeps({ routes: route(undefined, 404) });
    expect(
      await main(
        ['verify-published', '--repo', REPO, '--version', '2.2.0', '--sha', SHA, '--tries', '2'],
        f.deps,
      ),
    ).toBe(1);
    expect(f.lines.join('\n')).toMatch(/provenance-unavailable/);
  });
});

describe('dist-tag regression guard', () => {
  it('stable to latest, prerelease to next', () => {
    expect(planPublishTag({ version: '2.2.0', distTags: { latest: '2.1.0' } }).tag).toBe('latest');
    expect(planPublishTag({ version: '2.2.0-next.1', distTags: { latest: '2.1.0' } }).tag).toBe(
      'next',
    );
  });

  it('refuses stale attempts that would move a tag backwards', () => {
    expect(() => planPublishTag({ version: '2.0.1', distTags: { latest: '2.1.0' } })).toThrow(
      /regress/,
    );
    expect(() => planPublishTag({ version: '2.1.0', distTags: { latest: '2.1.0' } })).toThrow(
      /regress/,
    );
    expect(() =>
      planPublishTag({
        version: '2.2.0-next.1',
        distTags: { latest: '2.1.0', next: '2.2.0-next.2' },
      }),
    ).toThrow(/regress/);
    expect(() =>
      planPublishTag({ version: '2.1.0-next.9', distTags: { latest: '2.1.0' } }),
    ).toThrow(/not newer than latest/);
  });

  it('semver precedence', () => {
    expect(compareVersions('2.2.0-next.1', '2.2.0')).toBe(-1);
    expect(compareVersions('2.2.0-next.10', '2.2.0-next.9')).toBe(1);
  });
});

describe('publish', () => {
  const routes = { [`${enc}/2.2.0`]: { status: 404 } };

  it('missing auth fails explicitly with no fallback', async () => {
    const f = fakeDeps({
      routes,
      exec: (cmd) =>
        cmd === 'npm'
          ? { code: 1, stdout: '', stderr: 'npm error code ENEEDAUTH\nnpm error need auth' }
          : { code: 0, stdout: '', stderr: '' },
    });
    expect(
      await main(
        ['publish', '--version', '2.2.0', '--tag', 'latest', '--tarball', 'p.tgz'],
        f.deps,
      ),
    ).toBe(1);
    expect(f.outputs.publish_outcome).toBe('auth-failed');
    expect(f.outputs.registry_state_after).toBe('absent');
    const npm = f.calls.filter((c) => c[0] === 'npm');
    expect(npm).toEqual([
      [
        'npm',
        'publish',
        resolvePath('p.tgz'),
        '--tag',
        'latest',
        '--access',
        'public',
        '--provenance',
      ],
    ]);
    expect(f.lines.join('\n')).toMatch(/no token fallback/);
  });

  it('passes npm an absolute tarball path (a bare dir/file.tgz is GitHub shorthand to npm)', async () => {
    const f = fakeDeps({ routes, exec: () => ({ code: 0, stdout: '', stderr: '' }) });
    await main(
      ['publish', '--version', '2.2.0', '--tag', 'latest', '--tarball', 'release-artifact/p.tgz'],
      f.deps,
    );
    const spec = f.calls.find((c) => c[0] === 'npm')[2];
    expect(spec.startsWith('/')).toBe(true);
    expect(spec.endsWith('/release-artifact/p.tgz')).toBe(true);
  });

  it('refuses a dist-tag that does not match the channel', async () => {
    const f = fakeDeps();
    expect(
      await main(['publish', '--version', '2.2.0', '--tag', 'next', '--tarball', 'p.tgz'], f.deps),
    ).toBe(1);
    expect(f.calls.some(isMutation)).toBe(false);
  });
});

describe('stale next cleanup', () => {
  const tags = (...seq) => ({
    [`-/package/${enc}/dist-tags`]: seq.map((json) =>
      json instanceof Error ? json : { status: 200, json },
    ),
  });
  const rmOk = (cmd) => ({ code: 0, stdout: '', stderr: '' });

  it.each([
    [{ latest: '2.2.0' }, 'noop-absent'],
    [{ latest: '2.2.0', next: '2.3.0-next.1' }, 'noop-not-stale'],
    [{ latest: '2.2.0', next: '2.2.0' }, 'noop-not-stale'],
  ])('no-op for %j', async (t, outcome) => {
    const f = fakeDeps({ routes: tags(t), exec: rmOk });
    expect(await main(['cleanup-next', '--stable', '2.2.0'], f.deps)).toBe(0);
    expect(f.outputs.cleanup_outcome).toBe(outcome);
    expect(f.calls.some(isMutation)).toBe(false);
  });

  it('never runs for a prerelease', () => {
    expect(decideNextCleanup({ stableVersion: '2.3.0-next.1', next: '2.2.0-next.1' }).outcome).toBe(
      'noop-prerelease',
    );
  });

  it('removes a strictly older next and confirms', async () => {
    const f = fakeDeps({
      routes: tags({ next: '2.2.0-next.2' }, { next: '2.2.0-next.2' }, { latest: '2.2.0' }),
      exec: rmOk,
    });
    expect(await main(['cleanup-next', '--stable', '2.2.0'], f.deps)).toBe(0);
    expect(f.outputs.cleanup_outcome).toBe('removed');
    expect(f.calls.filter((c) => c[0] === 'npm')).toEqual([
      ['npm', 'dist-tag', 'rm', PACKAGE_NAME, 'next'],
    ]);
  });

  it('race: next moved between read and recheck → not removed', async () => {
    const f = fakeDeps({
      routes: tags({ next: '2.2.0-next.2' }, { next: '2.3.0-next.1' }),
      exec: rmOk,
    });
    expect(await main(['cleanup-next', '--stable', '2.2.0'], f.deps)).toBe(0);
    expect(f.outputs.cleanup_outcome).toBe('skipped-changed');
    expect(f.calls.some(isMutation)).toBe(false);
  });

  it('removal error is reported, not swallowed, and does not fail the run', async () => {
    const f = fakeDeps({
      routes: tags({ next: '2.2.0-next.2' }),
      exec: () => ({
        code: 1,
        stdout: '',
        stderr: 'npm error code E401\nnpm error Unable to authenticate',
      }),
    });
    expect(await main(['cleanup-next', '--stable', '2.2.0'], f.deps)).toBe(0);
    expect(f.outputs.cleanup_outcome).toBe('error-remove');
    expect(f.lines.join('\n')).toMatch(/::warning::.*E401|WARNING: .*E401/);
  });

  it('query error is reported without deleting', async () => {
    const f = fakeDeps({
      routes: tags(new Error('boom'), new Error('boom'), new Error('boom'), new Error('boom')),
      exec: rmOk,
    });
    expect(await main(['cleanup-next', '--stable', '2.2.0'], f.deps)).toBe(0);
    expect(f.outputs.cleanup_outcome).toBe('error-query');
    expect(f.calls.some(isMutation)).toBe(false);
  });

  it('removal not confirmed is reported', async () => {
    const f = fakeDeps({
      routes: tags({ next: '2.2.0-next.2' }, { next: '2.2.0-next.2' }),
      exec: rmOk,
    });
    expect(await main(['cleanup-next', '--stable', '2.2.0'], f.deps)).toBe(0);
    expect(f.outputs.cleanup_outcome).toBe('error-unconfirmed');
  });
});

describe('finalization', () => {
  const notes = 'Hello\n\n- entry (abc1234)\n';
  const files = { 'n.md': notes };
  const view = (rel) => (cmd, args) =>
    args[0] === 'release' && args[1] === 'view'
      ? rel
        ? { code: 0, stdout: JSON.stringify(rel), stderr: '' }
        : { code: 1, stdout: '', stderr: 'release not found' }
      : { code: 0, stdout: '', stderr: '' };
  const args = [
    'finalize',
    '--tag',
    'v2.2.0',
    '--version',
    '2.2.0',
    '--notes-file',
    'n.md',
    '--repo',
    REPO,
  ];
  const match = {
    tagName: 'v2.2.0',
    name: 'v2.2.0',
    body: notes,
    isDraft: false,
    isPrerelease: false,
  };

  it('creates when absent', async () => {
    const f = fakeDeps({ files, exec: view(null) });
    expect(await main(args, f.deps)).toBe(0);
    expect(f.outputs.finalize_outcome).toBe('created');
    expect(f.calls.find((c) => c[2] === 'create')).toContain('--verify-tag');
  });

  it('resume: matching release is preserved without mutation', async () => {
    const f = fakeDeps({ files, exec: view(match) });
    expect(await main(args, f.deps)).toBe(0);
    expect(f.outputs.finalize_outcome).toBe('already-final');
    expect(f.calls.some(isMutation)).toBe(false);
  });

  it('resume: matching draft is published', async () => {
    const f = fakeDeps({ files, exec: view({ ...match, isDraft: true }) });
    expect(await main(args, f.deps)).toBe(0);
    expect(f.outputs.finalize_outcome).toBe('published-draft');
  });

  it('conflicting metadata is never overwritten', async () => {
    const f = fakeDeps({ files, exec: view({ ...match, body: 'hand-edited' }) });
    expect(await main(args, f.deps)).toBe(1);
    expect(f.outputs.finalize_outcome).toBe('conflict');
    expect(f.calls.some(isMutation)).toBe(false);
  });

  it('prerelease flag mismatch is a conflict', () => {
    expect(
      planFinalization({
        existing: { ...match, isPrerelease: true },
        expected: { tag: 'v2.2.0', title: 'v2.2.0', prerelease: false, notes },
      }).action,
    ).toBe('conflict');
  });

  it('release notes come from the changelog body', () => {
    expect(extractReleaseNotes('---\ntitle: v2.2.0\n---\n\nIntro\n\n- a (abc)\n')).toBe(
      'Intro\n\n- a (abc)\n',
    );
    expect(() => extractReleaseNotes('---\ntitle: x\n---\n\n')).toThrow(/empty/);
  });
});

describe('release start (release.yml)', () => {
  const changelog = '---\ntitle: v2.2.0\n---\n\nIntro\n';
  const ghFor =
    ({ tagRef } = {}) =>
    (cmd, args) => {
      if (cmd === 'git' && args[0] === 'show') {
        return args[1].endsWith(':package.json')
          ? { code: 0, stdout: JSON.stringify(pkg('2.2.0')), stderr: '' }
          : { code: 0, stdout: changelog, stderr: '' };
      }
      if (cmd === 'git' && args[0] === 'rev-parse')
        return { code: 0, stdout: `${SHA}\n`, stderr: '' };
      if (cmd === 'git') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'api' && args[1].includes('/actions/workflows/ci.yml/runs')) {
        return {
          code: 0,
          stdout: JSON.stringify({
            workflow_runs: [
              {
                id: 42,
                head_sha: SHA,
                event: 'push',
                head_branch: 'main',
                status: 'completed',
                conclusion: 'success',
                run_attempt: 1,
              },
            ],
          }),
          stderr: '',
        };
      }
      if (args[0] === 'api' && args[1].includes('/git/ref/tags/')) {
        return tagRef
          ? {
              code: 0,
              stdout: JSON.stringify({ object: { type: 'commit', sha: tagRef } }),
              stderr: '',
            }
          : { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
      }
      if (args.includes('POST') && args.some((a) => a.endsWith('/dispatches'))) {
        return { code: 0, stdout: JSON.stringify({ workflow_run_id: 99 }), stderr: '' };
      }
      return { code: 0, stdout: '{}', stderr: '' };
    };
  const routes = {
    [`${enc}/2.2.0`]: { status: 404 },
    [`-/package/${enc}/dist-tags`]: { status: 200, json: { latest: '2.1.0' } },
  };
  const base = [
    'start',
    '--sha',
    SHA,
    '--version',
    '2.2.0',
    '--repo',
    REPO,
    '--ref',
    'refs/heads/main',
    '--request-id',
    'r1',
  ];

  it('dry-run admits and performs no mutation', async () => {
    const f = fakeDeps({ routes, exec: ghFor() });
    expect(await main([...base, '--dry-run'], f.deps)).toBe(0);
    expect(f.calls.some(isMutation)).toBe(false);
    expect(f.lines.join('\n')).toMatch(/DRY RUN/);
    expect(f.outputs.ci_run_id).toBe('42');
  });

  it('executes: creates the tag then dispatches publish.yml and records the run id', async () => {
    const f = fakeDeps({ routes, exec: ghFor() });
    expect(await main(base, f.deps)).toBe(0);
    expect(f.calls.filter(isMutation).map((c) => c.find((a) => a.startsWith('repos/')))).toEqual([
      `repos/${REPO}/git/refs`,
      `repos/${REPO}/actions/workflows/publish.yml/dispatches`,
    ]);
    expect(f.outputs.publish_run_id).toBe('99');
  });

  it('refuses a non-main ref before any read of the registry', async () => {
    const f = fakeDeps({ routes, exec: ghFor() });
    const args = [...base];
    args[args.indexOf('refs/heads/main')] = 'refs/heads/feature';
    expect(await main(args, f.deps)).toBe(1);
    expect(f.calls).toEqual([]);
  });

  it('refuses when the version is already published (recovery goes through publish.yml)', async () => {
    const f = fakeDeps({
      routes: { ...routes, [`${enc}/2.2.0`]: { status: 200, json: { version: '2.2.0' } } },
      exec: ghFor(),
    });
    expect(await main([...base, '--dry-run'], f.deps)).toBe(1);
    expect(f.lines.join('\n')).toMatch(/already-published/);
  });

  it('refuses when the tag already points elsewhere', async () => {
    const f = fakeDeps({ routes, exec: ghFor({ tagRef: OTHER }) });
    expect(await main(base, f.deps)).toBe(1);
    expect(f.calls.some(isMutation)).toBe(false);
  });

  it('refuses on registry uncertainty', async () => {
    const f = fakeDeps({ routes: { ...routes, [`${enc}/2.2.0`]: { status: 503 } }, exec: ghFor() });
    expect(await main([...base, '--dry-run'], f.deps)).toBe(1);
    expect(f.lines.join('\n')).toMatch(/registry-unknown/);
  });
});

describe('version selection (stable-by-default)', () => {
  const c = (subject, body = '') => ({ subject, body });
  it.each([
    ['2.1.0', '', [c('fix: x')], '2.1.1'],
    ['2.1.0', '', [c('feat(cli): x')], '2.2.0'],
    ['2.1.0', '', [c('fix: x', 'BREAKING CHANGE: y')], '3.0.0'],
    ['2.1.0', 'minor', [], '2.2.0'],
    ['2.1.0', 'next', [c('feat: x')], '2.2.0-next.1'],
    ['2.2.0-next.1', 'next', [], '2.2.0-next.2'],
    ['2.2.0-next.1', 'stable', [], '2.2.0'],
    ['1.1.0-next.3', 'major', [], '2.0.0'],
    ['1.1.0-next.3', 'next patch', [], '1.1.1-next.1'],
  ])('%s + "%s" → %s', (current, arg, commits, expected) => {
    expect(computeNextVersion({ current, arg, commits, lastStable: '1.0.0' }).version).toBe(
      expected,
    );
  });

  it('no-arg promotion escalates from the last stable tag', () => {
    expect(
      computeNextVersion({ current: '1.1.0-next.3', commits: [c('feat: x')], lastStable: '1.0.0' })
        .version,
    ).toBe('1.1.0');
    expect(
      computeNextVersion({ current: '1.1.0-next.3', commits: [c('feat!: x')], lastStable: '1.0.0' })
        .version,
    ).toBe('2.0.0');
  });

  it('flags a range with nothing release-worthy', () => {
    expect(
      computeNextVersion({ current: '2.1.0', commits: [c('docs: x')] }).noQualifyingCommits,
    ).toBe(true);
    expect(
      computeNextVersion({ current: '2.1.0', commits: [c('fix: x')] }).noQualifyingCommits,
    ).toBe(true);
    expect(
      computeNextVersion({ current: '2.1.0', commits: [c('feat: x')] }).noQualifyingCommits,
    ).toBe(false);
  });

  it('errors on stable from stable and on unknown args', () => {
    expect(() => computeNextVersion({ current: '2.1.0', arg: 'stable' })).toThrow(/already stable/);
    expect(() => computeNextVersion({ current: '2.1.0', arg: 'huge' })).toThrow(/unknown argument/);
  });
});

describe('runtime assertion', () => {
  it('requires the pinned npm and Node >= 22.14.0', async () => {
    const good = fakeDeps({ exec: () => ({ code: 0, stdout: '11.21.1\n', stderr: '' }) });
    expect(await main(['assert-runtime'], good.deps)).toBe(0);
    const badNpm = fakeDeps({ exec: () => ({ code: 0, stdout: '10.9.2\n', stderr: '' }) });
    expect(await main(['assert-runtime'], badNpm.deps)).toBe(1);
    const oldNode = fakeDeps({ exec: () => ({ code: 0, stdout: '11.21.1\n', stderr: '' }) });
    oldNode.deps.nodeVersion = '22.13.1';
    expect(await main(['assert-runtime'], oldNode.deps)).toBe(1);
  });
});

describe('review fixes', () => {
  const run = (o) => ({
    head_sha: SHA,
    event: 'push',
    head_branch: 'main',
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    ...o,
  });

  it('CI: the newest run for the SHA decides; an older green run cannot outvote a newer red one', () => {
    expect(selectCiRun([run({ id: 1 }), run({ id: 2, conclusion: 'failure' })], SHA)).toMatchObject(
      { status: 'refused', runId: 2 },
    );
    expect(
      selectCiRun([run({ id: 1, conclusion: 'cancelled' }), run({ id: 2 })], SHA),
    ).toMatchObject({ status: 'admitted', runId: 2 });
    expect(
      selectCiRun([run({ id: 3, status: 'in_progress', conclusion: null, run_attempt: 2 })], SHA),
    ).toMatchObject({ status: 'pending', attempt: 2 });
  });

  it('dist-tags 404 is unknown (never "no tags"), so the regression guard fails closed', async () => {
    const f = fakeDeps({ routes: { [`-/package/${enc}/dist-tags`]: { status: 404 } } });
    expect(await main(['plan-publish-tag', '--version', '2.2.0'], f.deps)).toBe(1);
    expect(f.lines.join('\n')).toMatch(/registry-unknown/);
    const c = fakeDeps({ routes: { [`-/package/${enc}/dist-tags`]: { status: 404 } } });
    expect(await main(['cleanup-next', '--stable', '2.2.0'], c.deps)).toBe(0);
    expect(c.outputs.cleanup_outcome).toBe('error-query');
  });

  it('provenance from another repository or workflow is a conflict', async () => {
    const p = provenance(SHA);
    const stmt = JSON.parse(Buffer.from(p.attestations[0].bundle.dsseEnvelope.payload, 'base64'));
    stmt.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/evil.yml';
    p.attestations[0].bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(stmt)).toString(
      'base64',
    );
    const f = fakeDeps({ routes: { [`attestations/${enc}@2.2.0`]: { status: 200, json: p } } });
    expect(
      await main(['verify-published', '--repo', REPO, '--version', '2.2.0', '--sha', SHA], f.deps),
    ).toBe(1);
    expect(f.outputs.provenance).toBe('conflict');
  });

  it('plan sorts tags semantically (a stable tag outranks its own -next prerelease)', async () => {
    const f = fakeDeps({
      files: { 'package.json': JSON.stringify(pkg('2.2.0')) },
      exec: (cmd, args) => {
        if (args[0] === 'tag')
          return {
            code: 0,
            stdout: 'v2.1.0\nv2.2.0-next.1\nv2.2.0\nv2.10.0-rc.1\nvbogus\n',
            stderr: '',
          };
        if (args[0] === 'log') return { code: 0, stdout: '', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    expect(await main(['plan', '--arg', 'patch'], f.deps)).toBe(0);
    expect(f.calls.find((c) => c[1] === 'log')[2]).toBe('v2.10.0-rc.1..HEAD');
    const g = fakeDeps({
      files: { 'package.json': JSON.stringify(pkg('2.2.0')) },
      exec: (cmd, args) =>
        args[0] === 'tag'
          ? { code: 0, stdout: 'v2.2.0-next.1\nv2.2.0\nv2.1.0\n', stderr: '' }
          : { code: 0, stdout: '', stderr: '' },
    });
    expect(await main(['plan'], g.deps)).toBe(0);
    expect(g.calls.find((c) => c[1] === 'log')[2]).toBe('v2.2.0..HEAD');
  });

  it('finalize: an older stable never takes "Latest"; the newest stable does', async () => {
    const notes = 'N\n';
    const mk = (latestTag) =>
      fakeDeps({
        files: { 'n.md': notes },
        exec: (cmd, args) => {
          if (args[1] === 'view') return { code: 1, stdout: '', stderr: 'release not found' };
          if (args[0] === 'api') return { code: 0, stdout: `${latestTag}\n`, stderr: '' };
          return { code: 0, stdout: '', stderr: '' };
        },
      });
    const args = [
      'finalize',
      '--tag',
      'v2.0.1',
      '--version',
      '2.0.1',
      '--notes-file',
      'n.md',
      '--repo',
      REPO,
    ];
    const older = mk('v2.1.0');
    expect(await main(args, older.deps)).toBe(0);
    expect(older.calls.find((c) => c[2] === 'create')).toContain('--latest=false');
    const newest = mk('v2.0.0');
    expect(await main(args, newest.deps)).toBe(0);
    expect(newest.calls.find((c) => c[2] === 'create')).toContain('--latest');
  });

  it('flag values may contain "="', async () => {
    const f = fakeDeps();
    expect(
      await main(
        [
          'admit-tag',
          '--tag=v2.2.0',
          `--package-json-text=${JSON.stringify({ ...pkg('2.2.0'), x: 'a=b=c' })}`,
        ],
        f.deps,
      ),
    ).toBe(0);
    expect(f.outputs.version).toBe('2.2.0');
  });
});

describe('release workflows', () => {
  // setup-node v5 enables a packageManager cache by default, which fails in jobs without pnpm.
  it.each(['publish.yml', 'release.yml'])(
    '%s disables the setup-node package-manager cache',
    async (name) => {
      const { readFileSync } = await import('node:fs');
      const src = readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
      const steps = src
        .split(/\n(?= *- (?:uses|name):)/)
        .filter((s) => /uses: actions\/setup-node@/.test(s));
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) expect(step).toMatch(/\n\s+package-manager-cache: false\n/);
    },
  );
});

// ── Cloud release path (issue #201) ──────────────────────────────────────────
describe('Cloud release path: fixed candidate, resume, diagnostics', () => {
  const HEAD = 'c'.repeat(40);
  const CONTROL = 'd'.repeat(40);
  const changelog = '---\ntitle: v2.2.0\n---\n\nIntro\n';
  const ciRun = (conclusion) => ({
    id: 42,
    head_sha: SHA,
    event: 'push',
    head_branch: 'main',
    status: 'completed',
    conclusion,
    run_attempt: 1,
  });

  // A small fake GitHub + git world. `state.tag` changes when the tag is created.
  function world({
    head = SHA,
    tag = null,
    ci = 'success',
    ghLoggedOut = false,
    createTag = 'ok',
    dispatch = 'ok',
    wfDiff = '',
  } = {}) {
    const state = { tag };
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    const exec = (cmd, args) => {
      if (cmd === 'git') {
        if (args[0] === 'show') {
          return args[1].endsWith(':package.json')
            ? ok(JSON.stringify(pkg('2.2.0')))
            : ok(changelog);
        }
        if (args[0] === 'rev-parse') return ok(`${head}\n`);
        if (args[0] === 'rev-list') return ok('3\n');
        if (args[0] === 'diff') return ok(wfDiff);
        if (args[0] === 'ls-remote') {
          return ok(state.tag ? `${state.tag}\trefs/tags/v2.2.0\n` : '');
        }
        return ok();
      }
      // gh
      if (args[0] === 'api' && args[1].includes('/actions/workflows/ci.yml/runs')) {
        if (ghLoggedOut)
          return { code: 4, stdout: '', stderr: 'gh: To get started, run gh auth login' };
        return ok(JSON.stringify({ workflow_runs: [ciRun(ci)] }));
      }
      if (args[0] === 'api' && args[1].includes('/git/ref/tags/')) {
        return state.tag
          ? ok(JSON.stringify({ object: { type: 'commit', sha: state.tag } }))
          : { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
      }
      if (args.includes('POST') && args.some((a) => a.endsWith('/git/refs'))) {
        const sha = args.find((a) => a.startsWith('sha=')).slice(4);
        if (createTag === 'ok') {
          state.tag = sha;
          return ok('HTTP/2.0 201 Created\r\nContent-Type: application/json\r\n\r\n{}');
        }
        if (createTag === 'race-same' || createTag === 'race-other') {
          state.tag = createTag === 'race-same' ? sha : OTHER;
          return {
            code: 1,
            stdout: 'HTTP/2.0 422 Unprocessable Entity\n\n{"message":"Reference already exists"}',
            stderr: 'gh: Reference already exists (HTTP 422)',
          };
        }
        return {
          code: 1,
          stdout:
            'HTTP/2.0 403 Forbidden\r\nX-Github-Request-Id: ABCD:1234\r\nX-Accepted-Github-Permissions: contents=write\r\n\r\n' +
            '{"message":"Resource not accessible by integration","documentation_url":"https://docs.github.com/rest/git/refs#create-a-reference","status":"403"}',
          stderr: 'gh: Resource not accessible by integration (HTTP 403)',
        };
      }
      if (args.includes('POST') && args.some((a) => a.endsWith('/dispatches'))) {
        return dispatch === 'ok'
          ? ok('HTTP/2.0 200 OK\n\n{"workflow_run_id":99,"run_url":"x"}')
          : {
              code: 1,
              stdout: 'HTTP/2.0 500 Internal Server Error\n\n{"message":"Server Error"}',
              stderr: 'gh: Server Error (HTTP 500)',
            };
      }
      return ok('{}');
    };
    return { state, exec };
  }

  const absent = {
    [`${enc}/2.2.0`]: { status: 404 },
    [`-/package/${enc}/dist-tags`]: { status: 200, json: { latest: '2.1.0' } },
  };
  const published = (commit) => ({
    [`${enc}/2.2.0`]: { status: 200, json: { version: '2.2.0' } },
    [`-/package/${enc}/dist-tags`]: { status: 200, json: { latest: '2.2.0' } },
    [`attestations/${enc}@2.2.0`]: { status: 200, json: provenance(commit) },
  });
  const start = (...extra) => [
    'start',
    '--sha',
    SHA,
    '--version',
    '2.2.0',
    '--repo',
    REPO,
    '--ref',
    'refs/heads/main',
    '--request-id',
    'r1',
    '--control-sha',
    CONTROL,
    ...extra,
  ];
  const mutations = (f) =>
    f.calls.filter(isMutation).map((c) => c.find((a) => a.startsWith('repos/')));

  it('parses `gh api --include` output and plain bodies', () => {
    const r = parseGhApiResponse('HTTP/2.0 403 Forbidden\r\nX-A: b\r\n\r\n{"message":"m"}');
    expect(r).toMatchObject({ status: 403, headers: { 'x-a': 'b' }, json: { message: 'm' } });
    expect(parseGhApiResponse('{"workflow_run_id":7}').json.workflow_run_id).toBe(7);
    expect(parseGhApiResponse('').json).toBeNull();
  });

  it('new release: main moved on → the fixed candidate is tagged, never the new head', async () => {
    const w = world({ head: HEAD });
    const f = fakeDeps({ routes: absent, exec: w.exec });
    expect(await main(start(), f.deps)).toBe(0);
    expect(f.outputs.start_mode).toBe('new');
    expect(f.outputs.candidate_position).toBe('behind-main-by-3');
    expect(f.lines.join('\n')).toMatch(/main advanced: candidate a{40} .* origin\/main c{40}/);
    const mk = f.calls.find((c) => c.includes(`repos/${REPO}/git/refs`));
    expect(mk).toContain(`sha=${SHA}`);
    expect(mk.join(' ')).not.toContain(HEAD);
    expect(w.state.tag).toBe(SHA);
    expect(f.outputs.publish_run_id).toBe('99');
  });

  it('dry run is idempotent: re-sending it twice mutates nothing', async () => {
    for (let i = 0; i < 2; i++) {
      const f = fakeDeps({ routes: absent, exec: world().exec });
      expect(await main(start('--dry-run'), f.deps)).toBe(0);
      expect(f.calls.some(isMutation)).toBe(false);
      expect(f.lines.join('\n')).toMatch(/DRY RUN: would tag v2\.2\.0 at a{40}/);
    }
  });

  it('resume: tag at the same SHA keeps the original SHA even after main moved', async () => {
    const w = world({ head: HEAD, tag: SHA });
    const f = fakeDeps({ routes: absent, exec: w.exec });
    expect(await main(start(), f.deps)).toBe(0);
    expect(f.outputs.start_mode).toBe('resume');
    expect(f.outputs.tag_outcome).toBe('exists');
    expect(mutations(f)).toEqual([`repos/${REPO}/actions/workflows/publish.yml/dispatches`]);
    expect(f.lines.join('\n')).not.toMatch(/main advanced/);
  });

  it('resume after npm accepted the version: dispatch only if provenance matches', async () => {
    const good = fakeDeps({ routes: published(SHA), exec: world({ tag: SHA }).exec });
    expect(await main(start(), good.deps)).toBe(0);
    expect(good.outputs.provenance).toBe('match');
    expect(mutations(good)).toEqual([`repos/${REPO}/actions/workflows/publish.yml/dispatches`]);

    const bad = fakeDeps({ routes: published(OTHER), exec: world({ tag: SHA }).exec });
    expect(await main(start(), bad.deps)).toBe(1);
    expect(bad.lines.join('\n')).toMatch(/conflicting-publication/);
    expect(bad.calls.some(isMutation)).toBe(false);
  });

  it('new release refuses a version that is already on npm without its tag', async () => {
    const f = fakeDeps({ routes: published(SHA), exec: world().exec });
    expect(await main(start(), f.deps)).toBe(1);
    expect(f.lines.join('\n')).toMatch(/already-published/);
    expect(f.calls.some(isMutation)).toBe(false);
  });

  it('same-name tag at another SHA is refused before any mutation', async () => {
    const f = fakeDeps({ routes: absent, exec: world({ tag: OTHER }).exec });
    expect(await main(start(), f.deps)).toBe(1);
    expect(f.lines.join('\n')).toMatch(/tag-moved.*never moved: resume with sha=b{40}/);
    expect(f.calls.some(isMutation)).toBe(false);
  });

  it('tag race on re-send: created meanwhile at the same SHA is fine, at another SHA is refused', async () => {
    const same = fakeDeps({ routes: absent, exec: world({ createTag: 'race-same' }).exec });
    expect(await main(start(), same.deps)).toBe(0);
    expect(same.outputs.tag_outcome).toBe('exists');
    expect(same.outputs.publish_run_id).toBe('99');

    const other = fakeDeps({ routes: absent, exec: world({ createTag: 'race-other' }).exec });
    expect(await main(start(), other.deps)).toBe(1);
    expect(other.lines.join('\n')).toMatch(/tag-moved/);
    expect(mutations(other)).toEqual([`repos/${REPO}/git/refs`]);
  });

  it('403 on tag creation: reports status, request id, candidate/control SHA and workflow diff; no dispatch', async () => {
    const w = world({ head: HEAD, createTag: '403', wfDiff: '.github/workflows/release.yml\n' });
    const f = fakeDeps({
      routes: absent,
      exec: w.exec,
      env: { GITHUB_WORKFLOW_REF: 'x/y/.github/workflows/release.yml@refs/heads/main' },
    });
    expect(await main(start(), f.deps)).toBe(1);
    const text = f.lines.join('\n');
    expect(f.outputs.tag_http_status).toBe('403');
    expect(f.outputs.tag_outcome).toBe('failed');
    expect(text).toMatch(/diagnostic http status: 403/);
    expect(text).toMatch(/diagnostic message: Resource not accessible by integration/);
    expect(text).toMatch(/diagnostic x-github-request-id: ABCD:1234/);
    expect(text).toMatch(/diagnostic x-accepted-github-permissions: contents=write/);
    expect(text).toMatch(new RegExp(`diagnostic candidate SHA: ${SHA}`));
    expect(text).toMatch(new RegExp(`diagnostic control SHA \\(workflow commit\\): ${CONTROL}`));
    expect(text).toMatch(/differing candidate↔control: \.github\/workflows\/release\.yml/);
    expect(text).toMatch(/tag-create-failed.*no PAT or protection bypass/);
    // Observations only: the message must not claim a cause.
    expect(text).not.toMatch(/because|caused by/i);
    expect(f.calls.some((c) => c.some((a) => String(a).endsWith('/dispatches')))).toBe(false);
  });

  it('dispatch failure after tagging: reported with diagnostics; resume re-dispatches without a new tag', async () => {
    const w = world({ dispatch: 'fail' });
    const f = fakeDeps({ routes: absent, exec: w.exec });
    expect(await main(start(), f.deps)).toBe(1);
    expect(f.outputs.dispatch_http_status).toBe('500');
    expect(f.lines.join('\n')).toMatch(
      /dispatch-failed.*resume by starting release\.yml again with the same version and sha/,
    );
    expect(w.state.tag).toBe(SHA);

    // Resume: same inputs; the tag now exists at the same SHA.
    const again = fakeDeps({ routes: absent, exec: world({ tag: SHA }).exec });
    expect(await main(start(), again.deps)).toBe(0);
    expect(mutations(again)).toEqual([`repos/${REPO}/actions/workflows/publish.yml/dispatches`]);
  });

  it('registry uncertainty refuses in both modes', async () => {
    for (const tag of [null, SHA]) {
      const f = fakeDeps({
        routes: { ...absent, [`${enc}/2.2.0`]: { status: 503 } },
        exec: world({ tag }).exec,
      });
      expect(await main(start(), f.deps)).toBe(1);
      expect(f.lines.join('\n')).toMatch(/registry-unknown/);
      expect(f.calls.some(isMutation)).toBe(false);
    }
  });

  describe('candidate (read-only selection)', () => {
    const cand = (...extra) => ['candidate', '--fetch', 'false', '--request-id', 'q1', ...extra];

    it('selects the CI-green main head and prints dispatch inputs', async () => {
      const f = fakeDeps({ routes: absent, exec: world().exec });
      expect(await main(cand(), f.deps)).toBe(0);
      expect(f.outputs).toMatchObject({
        start_mode: 'new',
        candidate_sha: SHA,
        candidate_position: 'main-head',
        ci_status: 'admitted',
        request_id: 'q1',
      });
      expect(f.lines.join('\n')).toContain(
        JSON.stringify({ version: '2.2.0', sha: SHA, dry_run: 'true', request_id: 'q1' }),
      );
      expect(f.calls.some(isMutation)).toBe(false);
    });

    it('an explicit older --sha is kept, never replaced by the head', async () => {
      const f = fakeDeps({ routes: absent, exec: world({ head: HEAD }).exec });
      expect(await main(cand('--sha', SHA), f.deps)).toBe(0);
      expect(f.outputs.candidate_sha).toBe(SHA);
      expect(f.lines.join('\n')).toMatch(/kept as given \(never replaced\)/);
    });

    it('an existing tag selects resume at its original SHA', async () => {
      const f = fakeDeps({ routes: absent, exec: world({ head: HEAD, tag: SHA }).exec });
      expect(await main(cand(), f.deps)).toBe(0);
      expect(f.outputs).toMatchObject({ start_mode: 'resume', candidate_sha: SHA });
    });

    it('refuses red CI, a moved tag, unknown registry and already-published-without-tag', async () => {
      const red = fakeDeps({ routes: absent, exec: world({ ci: 'failure' }).exec });
      expect(await main(cand(), red.deps)).toBe(1);
      expect(red.lines.join('\n')).toMatch(/ci-not-green/);

      const moved = fakeDeps({ routes: absent, exec: world({ tag: OTHER }).exec });
      expect(await main(cand('--sha', SHA), moved.deps)).toBe(1);
      expect(moved.lines.join('\n')).toMatch(/tag-moved/);

      const unk = fakeDeps({
        routes: { ...absent, [`${enc}/2.2.0`]: { status: 503 } },
        exec: world().exec,
      });
      expect(await main(cand(), unk.deps)).toBe(1);
      expect(unk.lines.join('\n')).toMatch(/registry-unknown/);

      const pub = fakeDeps({ routes: published(SHA), exec: world().exec });
      expect(await main(cand(), pub.deps)).toBe(1);
      expect(pub.lines.join('\n')).toMatch(/already-published/);
    });

    it('works without a gh login: CI is reported unchecked, not assumed green', async () => {
      const f = fakeDeps({ routes: absent, exec: world({ ghLoggedOut: true }).exec });
      expect(await main(cand(), f.deps)).toBe(0);
      expect(f.outputs.ci_status).toBe('unchecked');
      expect(f.lines.join('\n')).toMatch(/GitHub MCP or the Actions UI/);
    });
  });

  describe('review fixes (candidate / diagnostics)', () => {
    const cand = (...extra) => ['candidate', '--fetch', 'false', '--request-id', 'q1', ...extra];

    it('explicit --sha takes its version from that commit, not from a newer head bump', async () => {
      const w = world({ head: HEAD });
      const exec = (cmd, args) =>
        cmd === 'git' && args[0] === 'show' && args[1] === `${HEAD}:package.json`
          ? { code: 0, stdout: JSON.stringify(pkg('2.3.0')), stderr: '' }
          : w.exec(cmd, args);
      const f = fakeDeps({ routes: absent, exec });
      expect(await main(cand('--sha', SHA), f.deps)).toBe(0);
      expect(f.outputs).toMatchObject({ version: '2.2.0', candidate_sha: SHA });
    });

    it('no-arg candidate on a finished release says bump first; --sha resumes finalization', async () => {
      const f = fakeDeps({ routes: published(SHA), exec: world({ tag: SHA }).exec });
      expect(await main(cand(), f.deps)).toBe(1);
      expect(f.lines.join('\n')).toMatch(/already-released.*bump first/);

      const r = fakeDeps({ routes: published(SHA), exec: world({ tag: SHA }).exec });
      expect(await main(cand('--sha', SHA), r.deps)).toBe(0);
      expect(r.outputs.start_mode).toBe('resume');
    });

    it('a failing gh read is reported as unchecked with its reason, never as green', async () => {
      for (const res of [
        { code: 1, stdout: '', stderr: 'gh: Server Error (HTTP 502)' },
        { code: 0, stdout: '<html>proxy</html>', stderr: '' },
      ]) {
        const w = world();
        const exec = (cmd, args) =>
          cmd === 'gh' && String(args[1]).includes('/ci.yml/runs') ? res : w.exec(cmd, args);
        const f = fakeDeps({ routes: absent, exec });
        expect(await main(cand(), f.deps)).toBe(0);
        expect(f.outputs.ci_status).toBe('unchecked');
        expect(f.lines.join('\n')).toMatch(
          /unchecked here \(gh: (HTTP|gh: Server Error|unreadable)/,
        );
      }
    });

    it('403 diagnostics survive a failing tag re-read', async () => {
      const w = world({ createTag: '403' });
      let posted = false;
      const exec = (cmd, args) => {
        if (args.includes('POST')) posted = true;
        if (posted && cmd === 'gh' && String(args[1]).includes('/git/ref/tags/')) {
          return { code: 1, stdout: '', stderr: 'gh: Bad Gateway (HTTP 502)' };
        }
        return w.exec(cmd, args);
      };
      const f = fakeDeps({ routes: absent, exec });
      expect(await main(start(), f.deps)).toBe(1);
      expect(f.outputs.tag_http_status).toBe('403');
      expect(f.lines.join('\n')).toMatch(/diagnostic tag re-read after the failed create: .*502/);
      expect(f.lines.join('\n')).toMatch(/tag-create-failed/);
    });
  });

  describe('preflight (capability-based, read-only)', () => {
    const exec =
      ({ gh = 'none', perms = null } = {}) =>
      (cmd, args) => {
        if (cmd === 'gh') {
          if (gh === 'none') return { code: 127, stdout: '', stderr: 'spawnSync gh ENOENT' };
          if (args[0] === '--version') return { code: 0, stdout: 'gh version 2', stderr: '' };
          if (args[0] === 'auth') {
            return gh === 'auth'
              ? { code: 0, stdout: '', stderr: '' }
              : { code: 1, stdout: '', stderr: 'The token in GH_TOKEN is invalid.' };
          }
          if (args[0] === 'api') return { code: 0, stdout: JSON.stringify(perms), stderr: '' };
          if (args[0] === 'run') return { code: 0, stdout: '[]', stderr: '' };
        }
        if (cmd === 'git' && args[0] === 'branch') return { code: 0, stdout: 'main\n', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      };

    it('no gh, GitHub MCP unknown → probe first; never suggests a tag push', async () => {
      const f = fakeDeps({ exec: exec() });
      expect(await main(['preflight'], f.deps)).toBe(0);
      expect(f.outputs.initiation).toBe('probe-github-mcp');
      const text = f.lines.join('\n');
      expect(text).toMatch(/no +gh CLI authenticated — gh not installed/);
      expect(text).toMatch(/not needed git push tag/);
      expect(
        f.calls.some((c) => c[0] === 'git' && c[1] === 'push' && !c.includes('--dry-run')),
      ).toBe(false);
      expect(
        f.calls.some(
          (c) => c.includes('refs/tags/') || c.some((a) => String(a).includes('refs/tags')),
        ),
      ).toBe(false);
    });

    it('no gh login but the agent reports GitHub MCP → dispatch via MCP', async () => {
      const f = fakeDeps({ exec: exec({ gh: 'loggedout' }) });
      expect(await main(['preflight', '--github-mcp', 'yes'], f.deps)).toBe(0);
      expect(f.outputs).toMatchObject({ initiation: 'github-mcp', monitoring: 'gh' });
    });

    it('nothing available → manual hand-off', async () => {
      const f = fakeDeps({ exec: exec() });
      expect(await main(['preflight', '--github-mcp', 'no'], f.deps)).toBe(0);
      expect(f.outputs).toMatchObject({ initiation: 'manual', monitoring: 'manual' });
      expect(f.lines.join('\n')).toMatch(/owner runs release\.yml from the Actions UI/);
    });

    it('gh logged in but write not reported → try gh with a dry run; MCP monitoring uses read tools', async () => {
      const f = fakeDeps({ exec: exec({ gh: 'auth', perms: null }) });
      expect(await main(['preflight'], f.deps)).toBe(0);
      expect(f.outputs.initiation).toBe('gh-unverified');
      const m = fakeDeps({ exec: exec() });
      expect(await main(['preflight', '--github-mcp', 'yes'], m.deps)).toBe(0);
      const text = m.lines.join('\n');
      expect(text).toMatch(/run monitoring: GitHub MCP Actions run read tools/);
      expect(text.split('run monitoring')[1]).not.toMatch(/run_workflow/);
    });

    it('authenticated gh with write → gh dispatch', async () => {
      const f = fakeDeps({ exec: exec({ gh: 'auth', perms: { push: true } }) });
      expect(await main(['preflight'], f.deps)).toBe(0);
      expect(f.outputs.initiation).toBe('gh');
    });
  });
});

describe('release workflow invariants', () => {
  const read = async (name) => {
    const { readFileSync } = await import('node:fs');
    return readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
  };

  it('publish.yml keeps npm trusted publishing: no environment, no token, no registry-url', async () => {
    const src = (await read('publish.yml'))
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(src).not.toMatch(/^\s*environment:/m);
    expect(src).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
    expect(src).not.toMatch(/^\s*registry-url:/m);
    expect(src).toMatch(/id-token: write/);
  });

  it('release.yml: dispatch-only, run title carries the request id, control SHA is passed, no npm write', async () => {
    const src = await read('release.yml');
    expect(src).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(src).not.toMatch(/^\s+(push|pull_request|schedule):/m);
    expect(src).toMatch(/^run-name: .*inputs\.request_id/m);
    expect(src).toMatch(/CONTROL_SHA: \$\{\{ github\.workflow_sha \}\}/);
    expect(src).not.toMatch(/id-token|NPM_TOKEN|npm publish/);
    expect(src).toMatch(/if: \$\{\{ !inputs\.dry_run \}\}/);
  });
});
