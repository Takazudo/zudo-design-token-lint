#!/usr/bin/env node
// Release helper CLI shared by RELEASING.md (local / Codex Cloud) and the
// publish/release workflows. Run `node scripts/release/cli.mjs help`.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACKAGE_NAME,
  RELEASE_BRANCH,
  ReleaseError,
  admitBranchRef,
  admitTag,
  assertSha,
  candidatePosition,
  categorizeCommit,
  channelFor,
  compareVersions,
  computeNextVersion,
  decideNextCleanup,
  extractReleaseNotes,
  isAllowedVersion,
  isPrerelease,
  needsStableBase,
  parseGhApiResponse,
  planFinalization,
  planPublishTag,
  selectCiRun,
} from './lib.mjs';
import { getDistTags, getProvenance, getVersionState, poll } from './registry.mjs';

export const NPM_CLI_VERSION = '11.21.1';
export const MIN_NODE = [22, 14, 0];
export const CHANGELOG_DIR = 'doc/src/content/docs/changelog';
const CI_WORKFLOW = 'ci.yml';
const PUBLISH_WORKFLOW = 'publish.yml';
const START_WORKFLOW = 'release.yml';
const DEFAULT_REPO = 'Takazudo/zudo-design-token-lint';

export function realDeps() {
  return {
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    exec(cmd, args, { input, stream = false } = {}) {
      const r = spawnSync(cmd, args, {
        input,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (stream) {
        process.stdout.write(r.stdout ?? '');
        process.stderr.write(r.stderr ?? '');
      }
      return {
        code: r.error ? 127 : r.status,
        stdout: r.stdout ?? '',
        stderr: r.error ? String(r.error.message) : (r.stderr ?? ''),
      };
    },
    env: process.env,
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, s) => writeFileSync(p, s),
    appendFile: (p, s) => appendFileSync(p, s),
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    nodeVersion: process.versions.node,
    now: () => Date.now(),
  };
}

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const v = eq < 0 ? undefined : a.slice(eq + 1);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = 'true';
    } else pos.push(a);
  }
  return { flags, pos };
}

function need(flags, key) {
  const v = flags[key];
  if (v === undefined || v === '') throw new ReleaseError('usage', `missing --${key}`);
  return v;
}

function makeCtx(deps) {
  return {
    ...deps,
    output(key, value) {
      if (deps.env.GITHUB_OUTPUT) deps.appendFile(deps.env.GITHUB_OUTPUT, `${key}=${value}\n`);
      deps.out(`${key}=${value}`);
    },
    summary(md) {
      if (deps.env.GITHUB_STEP_SUMMARY) deps.appendFile(deps.env.GITHUB_STEP_SUMMARY, `${md}\n`);
    },
    annotate(level, msg) {
      deps.out(deps.env.GITHUB_ACTIONS ? `::${level}::${msg}` : `${level.toUpperCase()}: ${msg}`);
    },
    run(cmd, args, opts) {
      return deps.exec(cmd, args, opts);
    },
    git(...args) {
      const r = deps.exec('git', args);
      if (r.code !== 0) {
        throw new ReleaseError('git', `git ${args.join(' ')} failed: ${r.stderr.trim()}`);
      }
      return r.stdout.trim();
    },
    gh(args, opts) {
      return deps.exec('gh', args, opts);
    },
  };
}

// Commit a remote tag points at (dereferencing annotated tags), or null if absent.
function remoteTagTarget(ctx, repo, tag) {
  const ref = ctx.gh(['api', `repos/${repo}/git/ref/tags/${tag}`]);
  if (ref.code !== 0) {
    if (/HTTP 404|Not Found/i.test(ref.stderr)) return null;
    throw new ReleaseError('gh', `cannot read ref ${tag}: ${ref.stderr.trim()}`);
  }
  const obj = JSON.parse(ref.stdout).object;
  if (obj.type !== 'tag') return obj.sha;
  const t = ctx.gh(['api', `repos/${repo}/git/tags/${obj.sha}`]);
  if (t.code !== 0) throw new ReleaseError('gh', `cannot read tag object: ${t.stderr.trim()}`);
  return JSON.parse(t.stdout).object.sha;
}

// The commit the running workflow file came from (release.yml's own commit),
// as opposed to the candidate commit being released.
function controlSha(ctx, flags) {
  return flags['control-sha'] || ctx.env.GITHUB_WORKFLOW_SHA || ctx.env.GITHUB_SHA || '';
}

// Current origin/main head and how far `sha` is behind it (null if unknown).
function mainPosition(ctx, sha) {
  const head = ctx.git('rev-parse', `origin/${RELEASE_BRANCH}`);
  let behind = 0;
  if (head !== sha) {
    const r = ctx.run('git', ['rev-list', '--count', `${sha}..origin/${RELEASE_BRANCH}`]);
    behind = r.code === 0 && /^\d+$/.test(r.stdout.trim()) ? Number(r.stdout.trim()) : null;
  }
  return { head, behind, position: candidatePosition({ sha, head, behind }) };
}

// Workflow files that differ between the candidate and the control commit.
function workflowDiff(ctx, candidate, control) {
  if (!control) return 'unknown (no control SHA)';
  if (control === candidate) return 'none (candidate is the control commit)';
  const r = ctx.run('git', ['diff', '--name-only', candidate, control, '--', '.github/workflows']);
  if (r.code !== 0) return `unknown (${r.stderr.trim().split('\n')[0] || `git exit ${r.code}`})`;
  const files = r.stdout.trim().split('\n').filter(Boolean);
  return files.length ? files.join(', ') : 'none';
}

// Report a refused GitHub API mutation with everything needed to diagnose it.
// The cause is NOT inferred: in particular, a 403 on tag creation for an older
// candidate has only been *hypothesised* to relate to workflow-file differences.
function reportApiFailure(ctx, { action, res, candidate, control, prefix }) {
  const p = parseGhApiResponse(res.stdout);
  const statusFromErr = /HTTP (\d{3})/.exec(res.stderr ?? '');
  const status = p.status ?? (statusFromErr ? Number(statusFromErr[1]) : null);
  const message = p.json?.message ?? (res.stderr ?? '').trim().split('\n')[0];
  const rows = [
    ['action', action],
    ['http status', status ?? 'unknown'],
    ['message', message || '(none)'],
    ['documentation_url', p.json?.documentation_url ?? '(none)'],
    ['x-github-request-id', p.headers['x-github-request-id'] ?? '(none)'],
    ['x-accepted-github-permissions', p.headers['x-accepted-github-permissions'] ?? '(none)'],
    ['candidate SHA', candidate],
    ['control SHA (workflow commit)', control || 'unknown'],
    ['workflow ref', ctx.env.GITHUB_WORKFLOW_REF ?? 'unknown'],
    ['.github/workflows differing candidate↔control', workflowDiff(ctx, candidate, control)],
  ];
  ctx.output(`${prefix}_http_status`, status ?? 'unknown');
  for (const [k, v] of rows) ctx.out(`diagnostic ${k}: ${v}`);
  ctx.summary(
    [
      `### ${action} refused`,
      '',
      '| Field | Value |',
      '| --- | --- |',
      ...rows.map(([k, v]) => `| ${k} | \`${String(v).replace(/\|/g, '\\|')}\` |`),
      '',
      'These are observations, not a diagnosis. Do not add a PAT or bypass protection: report these fields.',
    ].join('\n'),
  );
  return { status, message };
}

function readPackageJson(ctx, file = 'package.json') {
  return JSON.parse(ctx.readFile(file));
}

// ── commands ─────────────────────────────────────────────────────────────────

const commands = {
  // Exact tag grammar + package name + tag == package.json version.
  'admit-tag'(ctx, { flags }) {
    const tag = need(flags, 'tag');
    const pkg = flags['package-json-text']
      ? JSON.parse(flags['package-json-text'])
      : readPackageJson(ctx, flags['package-json'] ?? 'package.json');
    const r = admitTag({ tag, packageJson: pkg });
    ctx.output('tag', r.tag);
    ctx.output('version', r.version);
    ctx.output('channel', r.channel);
    ctx.output('prerelease', String(r.prerelease));
    return 0;
  },

  'admit-branch'(ctx, { flags }) {
    admitBranchRef(need(flags, 'ref'));
    ctx.out(`ref ${flags.ref} admitted`);
    return 0;
  },

  // Source admission: the commit must be on origin/main; tag (if given) must resolve to it.
  'admit-source'(ctx, { flags }) {
    const sha = assertSha(need(flags, 'sha'));
    if (flags.tag) {
      const tagged = ctx.git('rev-parse', `refs/tags/${flags.tag}^{commit}`);
      if (tagged !== sha) {
        throw new ReleaseError('tag-moved', `${flags.tag} resolves to ${tagged}, expected ${sha}`);
      }
    }
    const r = ctx.run('git', ['merge-base', '--is-ancestor', sha, `origin/${RELEASE_BRANCH}`]);
    if (r.code === 1) {
      throw new ReleaseError(
        'not-on-main',
        `${sha} is not reachable from origin/${RELEASE_BRANCH}`,
      );
    }
    if (r.code !== 0) throw new ReleaseError('git', `ancestry check failed: ${r.stderr.trim()}`);
    ctx.output('sha', sha);
    return 0;
  },

  // CI admission: a successful CI push run for exactly this SHA, bounded wait.
  async 'admit-ci'(ctx, { flags }) {
    const sha = assertSha(need(flags, 'sha'));
    const repo = need(flags, 'repo');
    const tries = Number(flags.tries ?? 60);
    const delayMs = Number(flags['interval-sec'] ?? 30) * 1000;
    let sel;
    for (let i = 1; i <= tries; i++) {
      const r = ctx.gh([
        'api',
        `repos/${repo}/actions/workflows/${CI_WORKFLOW}/runs?head_sha=${sha}&per_page=100`,
      ]);
      if (r.code !== 0) throw new ReleaseError('gh', `listing CI runs failed: ${r.stderr.trim()}`);
      sel = selectCiRun(JSON.parse(r.stdout).workflow_runs, sha);
      if (sel.status === 'admitted' || sel.status === 'refused') break;
      if (i < tries) {
        ctx.out(`CI for ${sha}: ${sel.status} (check ${i}/${tries})`);
        await ctx.sleep(delayMs);
      }
    }
    if (sel.status !== 'admitted') {
      const detail = sel.runId ? ` run ${sel.runId} attempt ${sel.attempt}: ${sel.conclusion}` : '';
      throw new ReleaseError(
        'ci-not-green',
        `no successful CI push run for ${sha} (${sel.status}${detail})`,
      );
    }
    ctx.output('ci_run_id', sel.runId);
    ctx.output('ci_run_attempt', sel.attempt);
    ctx.output('ci_run_url', sel.url);
    return 0;
  },

  // Exact registry state; `unknown` is a failure, never treated as absent.
  async 'registry-state'(ctx, { flags }) {
    const version = need(flags, 'version');
    const r = await getVersionState(PACKAGE_NAME, version, ctx);
    ctx.output('registry_state', r.state);
    if (r.state === 'unknown') {
      throw new ReleaseError(
        'registry-unknown',
        `cannot determine whether ${version} is published: ${r.error}`,
      );
    }
    return 0;
  },

  // An existing publication is accepted only if its provenance names this source.
  async 'verify-published'(ctx, { flags }) {
    const version = need(flags, 'version');
    const sha = assertSha(need(flags, 'sha'));
    const res = await poll(
      () => getProvenance(PACKAGE_NAME, version, ctx),
      (p) => p.state === 'ok',
      ctx,
      { tries: Number(flags.tries ?? 6), delayMs: 10000 },
    );
    const p = res.value;
    const repoUrl = `https://github.com/${need(flags, 'repo')}`;
    if (p.state !== 'ok') {
      ctx.output('provenance', 'unavailable');
      throw new ReleaseError(
        'provenance-unavailable',
        `${version} is published but its provenance is ${p.state}${p.error ? `: ${p.error}` : ''}; cannot confirm it was built from ${sha}`,
      );
    }
    if (
      p.commit !== sha ||
      p.repository !== repoUrl ||
      p.workflow !== `.github/workflows/${PUBLISH_WORKFLOW}`
    ) {
      ctx.output('provenance', 'conflict');
      throw new ReleaseError(
        'conflicting-publication',
        `${version} on npm was built from ${p.commit} by ${p.repository}/${p.workflow} (${p.ref}), not ${sha} by ${repoUrl}/.github/workflows/${PUBLISH_WORKFLOW}; refusing to finalize`,
      );
    }
    ctx.output('provenance', 'match');
    ctx.output('provenance_commit', p.commit);
    return 0;
  },

  // Dist-tag regression guard; prints the dist-tag to publish under.
  async 'plan-publish-tag'(ctx, { flags }) {
    const version = need(flags, 'version');
    const t = await getDistTags(PACKAGE_NAME, ctx);
    if (t.state !== 'ok')
      throw new ReleaseError('registry-unknown', `cannot read dist-tags: ${t.error}`);
    const plan = planPublishTag({ version, distTags: t.tags });
    ctx.output('publish_tag', plan.tag);
    ctx.output('previous_tag_version', plan.previous ?? '');
    return 0;
  },

  // Publish a prebuilt tarball with the pinned npm via OIDC. No token fallback exists.
  async publish(ctx, { flags }) {
    const version = need(flags, 'version');
    const tag = need(flags, 'tag');
    const tarball = need(flags, 'tarball');
    if (tag !== channelFor(version)) {
      throw new ReleaseError('bad-tag', `dist-tag ${tag} does not match channel of ${version}`);
    }
    // npm reads a bare `dir/file.tgz` spec as GitHub shorthand (`user/repo`), so pass an absolute path.
    const r = ctx.run(
      'npm',
      ['publish', resolvePath(tarball), '--tag', tag, '--access', 'public', '--provenance'],
      { stream: true },
    );
    if (r.code === 0) {
      ctx.output('publish_outcome', 'published');
      return 0;
    }
    const text = `${r.stdout}\n${r.stderr}`;
    const auth =
      /ENEEDAUTH|E401|EOTP|need auth|requires you to be logged in|Unable to authenticate/i.test(
        text,
      ) || /E404[\s\S]*(do not have permission|not have permission)/i.test(text);
    const after = await getVersionState(PACKAGE_NAME, version, ctx, { attempts: 2 });
    ctx.output('publish_outcome', auth ? 'auth-failed' : 'failed');
    ctx.output('registry_state_after', after.state);
    if (auth) {
      ctx.annotate(
        'error',
        "npm rejected authentication. Publishing uses OIDC trusted publishing only (no token fallback): check the npm trusted publisher (owner Takazudo, repo zudo-design-token-lint, workflow publish.yml, no environment) and the job's id-token: write permission.",
      );
    }
    throw new ReleaseError(
      'publish-failed',
      `npm publish exited ${r.code}; registry now reports '${after.state}' for ${version}`,
    );
  },

  // Post-publish propagation check (bounded).
  async 'await-published'(ctx, { flags }) {
    const version = need(flags, 'version');
    const res = await poll(
      () => getVersionState(PACKAGE_NAME, version, ctx, { attempts: 2 }),
      (s) => s.state === 'published',
      ctx,
      { tries: Number(flags.tries ?? 12), delayMs: 10000 },
    );
    if (!res.ok) {
      throw new ReleaseError(
        'not-visible',
        `${version} not visible on the registry after ${res.tries} checks (last: ${res.value.state}${res.value.error ? `, ${res.value.error}` : ''})`,
      );
    }
    ctx.out(`${version} visible on the registry`);
    return 0;
  },

  // Remove `next` only when strictly older than the stable just released. Always
  // reports an explicit outcome and exits 0: cleanup never fails a publication.
  async 'cleanup-next'(ctx, { flags }) {
    const stable = need(flags, 'stable');
    const finish = (outcome, level, msg) => {
      ctx.output('cleanup_outcome', outcome);
      if (level) ctx.annotate(level, msg);
      else ctx.out(msg);
      ctx.summary(`- stale \`next\` cleanup: **${outcome}** — ${msg}`);
      return 0;
    };
    const first = await getDistTags(PACKAGE_NAME, ctx);
    if (first.state !== 'ok')
      return finish('error-query', 'warning', `could not read dist-tags: ${first.error}`);
    const d = decideNextCleanup({ stableVersion: stable, next: first.tags.next });
    if (d.action === 'skip')
      return finish(
        d.outcome,
        null,
        `next=${first.tags.next ?? '(absent)'}, latest release ${stable}`,
      );
    const recheck = await getDistTags(PACKAGE_NAME, ctx, { attempts: 2 });
    if (recheck.state !== 'ok')
      return finish('error-query', 'warning', `recheck failed: ${recheck.error}`);
    if (recheck.tags.next !== first.tags.next) {
      return finish(
        'skipped-changed',
        null,
        `next moved ${first.tags.next} → ${recheck.tags.next ?? '(absent)'} since it was read; not removing`,
      );
    }
    const rm = ctx.run('npm', ['dist-tag', 'rm', PACKAGE_NAME, 'next'], { stream: true });
    if (rm.code !== 0) {
      return finish(
        'error-remove',
        'warning',
        `npm dist-tag rm failed (exit ${rm.code}): ${rm.stderr.trim().split('\n').slice(-3).join(' / ')}. Stale next=${first.tags.next} remains; see RELEASING.md`,
      );
    }
    const after = await poll(
      () => getDistTags(PACKAGE_NAME, ctx, { attempts: 2 }),
      (t) => t.state === 'ok' && !t.tags.next,
      ctx,
      { tries: 4, delayMs: 5000 },
    );
    if (!after.ok) {
      return finish(
        'error-unconfirmed',
        'warning',
        `removed next=${first.tags.next} but the registry still reports ${after.value.state === 'ok' ? `next=${after.value.tags.next}` : after.value.error}`,
      );
    }
    return finish('removed', null, `removed stale next=${first.tags.next}`);
  },

  'release-notes'(ctx, { flags }) {
    const version = need(flags, 'version');
    const src = flags.source ?? `${CHANGELOG_DIR}/v${version}.mdx`;
    let text;
    try {
      text = ctx.readFile(src);
    } catch {
      throw new ReleaseError('bad-notes', `release notes source ${src} not found`);
    }
    const notes = extractReleaseNotes(text);
    if (flags.out) ctx.writeFile(flags.out, notes);
    else ctx.out(notes);
    return 0;
  },

  // Idempotent GitHub Release: create, keep a matching one, publish a matching
  // draft, refuse to overwrite conflicting metadata.
  async finalize(ctx, { flags }) {
    const tag = need(flags, 'tag');
    const repo = need(flags, 'repo');
    const version = need(flags, 'version');
    const notesFile = need(flags, 'notes-file');
    const expected = {
      tag,
      title: tag,
      prerelease: isPrerelease(version),
      notes: ctx.readFile(notesFile),
    };
    // GitHub marks a new non-prerelease Release "Latest" by default; never let a
    // recovered older stable take that from a newer one.
    let latestArgs = ['--latest=false'];
    if (!expected.prerelease) {
      const cur = ctx.gh(['api', `repos/${repo}/releases/latest`, '--jq', '.tag_name']);
      const curTag = cur.code === 0 ? cur.stdout.trim() : null;
      if (cur.code !== 0 && !/HTTP 404|Not Found/i.test(cur.stderr)) {
        throw new ReleaseError('gh', `cannot read latest release: ${cur.stderr.trim()}`);
      }
      const newer =
        curTag &&
        isAllowedVersion(curTag.slice(1)) &&
        compareVersions(curTag.slice(1), version) > 0;
      latestArgs = newer ? ['--latest=false'] : ['--latest'];
    }
    for (let round = 1; round <= 2; round++) {
      const view = ctx.gh([
        'release',
        'view',
        tag,
        '--repo',
        repo,
        '--json',
        'tagName,name,body,isDraft,isPrerelease',
      ]);
      let existing = null;
      if (view.code === 0) existing = JSON.parse(view.stdout);
      else if (!/release not found/i.test(view.stderr)) {
        throw new ReleaseError('gh', `cannot read release ${tag}: ${view.stderr.trim()}`);
      }
      const plan = planFinalization({ existing, expected });
      if (plan.action === 'noop') {
        ctx.output('finalize_outcome', 'already-final');
        return 0;
      }
      if (plan.action === 'conflict') {
        ctx.output('finalize_outcome', 'conflict');
        throw new ReleaseError(
          'release-conflict',
          `GitHub Release ${tag} exists with different metadata (${plan.conflicts.join('; ')}); not overwriting`,
        );
      }
      const args =
        plan.action === 'create'
          ? [
              'release',
              'create',
              tag,
              '--repo',
              repo,
              '--verify-tag',
              '--title',
              tag,
              '--notes-file',
              notesFile,
              ...(expected.prerelease ? ['--prerelease'] : []),
              ...latestArgs,
            ]
          : ['release', 'edit', tag, '--repo', repo, '--draft=false', ...latestArgs];
      const r = ctx.gh(args);
      if (r.code === 0) {
        ctx.output('finalize_outcome', plan.action === 'create' ? 'created' : 'published-draft');
        return 0;
      }
      if (round === 2 || !/already exists/i.test(r.stderr)) {
        throw new ReleaseError('gh', `gh ${args[1]} failed: ${r.stderr.trim()}`);
      }
    }
    return 1;
  },

  // Create the release tag at an admitted SHA via the API (idempotent, never moves a tag).
  'create-tag'(ctx, { flags }) {
    const tag = need(flags, 'tag');
    const sha = assertSha(need(flags, 'sha'));
    const repo = need(flags, 'repo');
    const existing = (target) => {
      if (target !== sha)
        throw new ReleaseError('tag-moved', `${tag} already exists at ${target}, not ${sha}`);
      ctx.output('tag_outcome', 'exists');
      return 0;
    };
    const before = remoteTagTarget(ctx, repo, tag);
    if (before !== null) return existing(before);
    const mk = ctx.gh([
      'api',
      '--include',
      '-X',
      'POST',
      `repos/${repo}/git/refs`,
      '-f',
      `ref=refs/tags/${tag}`,
      '-f',
      `sha=${sha}`,
    ]);
    if (mk.code === 0) {
      ctx.output('tag_outcome', 'created');
      return 0;
    }
    // A concurrent or re-sent start may have created it meanwhile: same SHA is fine.
    let after = null;
    try {
      after = remoteTagTarget(ctx, repo, tag);
    } catch (err) {
      ctx.out(`diagnostic tag re-read after the failed create: ${err.message}`);
    }
    if (after !== null) return existing(after);
    const f = reportApiFailure(ctx, {
      action: `create ${tag} at ${sha}`,
      res: mk,
      candidate: sha,
      control: controlSha(ctx, flags),
      prefix: 'tag',
    });
    ctx.output('tag_outcome', 'failed');
    throw new ReleaseError(
      'tag-create-failed',
      `creating ${tag} failed (HTTP ${f.status ?? 'unknown'}: ${f.message}); nothing was published. See the diagnostic fields; no PAT or protection bypass is part of this procedure`,
    );
  },

  // Explicitly dispatch publish.yml on the tag ref (GITHUB_TOKEN tag pushes do not
  // trigger workflows) and return the exact run id.
  async 'dispatch-publish'(ctx, { flags }) {
    const tag = need(flags, 'tag');
    const repo = need(flags, 'repo');
    const requestId = need(flags, 'request-id');
    const r = ctx.gh([
      'api',
      '--include',
      '-X',
      'POST',
      `repos/${repo}/actions/workflows/${PUBLISH_WORKFLOW}/dispatches`,
      '-f',
      `ref=${tag}`,
      '-f',
      `inputs[request_id]=${requestId}`,
      '-F',
      'return_run_details=true',
    ]);
    if (r.code !== 0) {
      const f = reportApiFailure(ctx, {
        action: `dispatch ${PUBLISH_WORKFLOW} on ${tag}`,
        res: r,
        candidate: flags.sha ?? 'unknown',
        control: controlSha(ctx, flags),
        prefix: 'dispatch',
      });
      ctx.output('dispatch_outcome', 'failed');
      throw new ReleaseError(
        'dispatch-failed',
        `dispatching ${PUBLISH_WORKFLOW} on ${tag} failed (HTTP ${f.status ?? 'unknown'}: ${f.message}). The tag stays where it is; resume by starting ${START_WORKFLOW} again with the same version and sha, or dispatch ${PUBLISH_WORKFLOW} on ${tag}`,
      );
    }
    let runId = parseGhApiResponse(r.stdout).json?.workflow_run_id ?? null;
    if (!runId) {
      const found = await poll(
        () => {
          const l = ctx.gh([
            'api',
            `repos/${repo}/actions/workflows/${PUBLISH_WORKFLOW}/runs?event=workflow_dispatch&per_page=30`,
          ]);
          if (l.code !== 0) return [];
          return JSON.parse(l.stdout).workflow_runs.filter((w) =>
            String(w.display_title).includes(`[${requestId}]`),
          );
        },
        (m) => m.length > 0,
        ctx,
        { tries: 12, delayMs: 5000 },
      );
      if (!found.ok || found.value.length !== 1) {
        throw new ReleaseError(
          'run-not-found',
          `could not identify the dispatched publish run for request ${requestId}`,
        );
      }
      runId = found.value[0].id;
    }
    ctx.output('dispatch_outcome', 'dispatched');
    ctx.output('publish_run_id', runId);
    ctx.output('publish_run_url', `https://github.com/${repo}/actions/runs/${runId}`);
    return 0;
  },

  // Hosted release initiation (release.yml). Re-runs every admission check; with
  // --dry-run it performs reads only. Two modes, decided by the remote tag:
  //   new    (tag absent): tag the fixed candidate SHA, then dispatch publish.yml
  //   resume (tag at the same SHA): keep the original SHA, dispatch publish.yml
  // A tag at another SHA is refused. The SHA is never replaced by a newer main.
  async start(ctx, { flags }) {
    const dryRun = flags['dry-run'] === 'true';
    const sha = assertSha(need(flags, 'sha'));
    const version = need(flags, 'version');
    const repo = need(flags, 'repo');
    admitBranchRef(need(flags, 'ref'));
    const control = controlSha(ctx, flags);
    const tag = `v${version}`;
    const pkgText = ctx.git('show', `${sha}:package.json`);
    commands['admit-tag'](ctx, { flags: { tag, 'package-json-text': pkgText } });
    commands['admit-source'](ctx, { flags: { sha } });
    extractReleaseNotes(ctx.git('show', `${sha}:${CHANGELOG_DIR}/v${version}.mdx`));
    await commands['admit-ci'](ctx, {
      flags: { sha, repo, tries: flags.tries, 'interval-sec': flags['interval-sec'] },
    });
    const target = remoteTagTarget(ctx, repo, tag);
    if (target !== null && target !== sha) {
      throw new ReleaseError(
        'tag-moved',
        `${tag} already exists at ${target}, not ${sha}. A release tag is never moved: resume with sha=${target}, or cut a new version`,
      );
    }
    const mode = target === null ? 'new' : 'resume';
    const pos = mainPosition(ctx, sha);
    ctx.output('start_mode', mode);
    ctx.output('candidate_sha', sha);
    ctx.output('control_sha', control || 'unknown');
    ctx.output('main_head', pos.head);
    ctx.output('candidate_position', pos.position);
    if (mode === 'new' && pos.head !== sha) {
      ctx.annotate(
        'warning',
        `main advanced: candidate ${sha} is ${pos.behind ?? 'an unknown number of'} commit(s) behind origin/${RELEASE_BRANCH} ${pos.head}. The candidate is kept as the fixed release SHA (never replaced). To release newer commits, select a new candidate and start again.`,
      );
    }
    const st = await getVersionState(PACKAGE_NAME, version, ctx);
    ctx.output('registry_state', st.state);
    if (st.state === 'unknown')
      throw new ReleaseError('registry-unknown', `cannot determine registry state: ${st.error}`);
    if (st.state === 'published') {
      if (mode === 'new') {
        throw new ReleaseError(
          'already-published',
          `${version} is already on npm but ${tag} does not exist; refusing to tag. Investigate before any further step`,
        );
      }
      // Resume after npm accepted the version: publish.yml will skip the publish and
      // finalize, but only if the existing publication came from this exact commit.
      await commands['verify-published'](ctx, {
        flags: { version, sha, repo, tries: flags['provenance-tries'] },
      });
    } else {
      await commands['plan-publish-tag'](ctx, { flags: { version } });
    }
    const tagState = target === null ? 'absent' : 'exists-same-sha';
    ctx.output('tag_state', tagState);
    ctx.summary(
      [
        `### Release ${tag}: admitted (${dryRun ? 'dry run, nothing mutated' : 'starting'})`,
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| mode | \`${mode}\` |`,
        `| candidate SHA (fixed) | \`${sha}\` |`,
        `| origin/${RELEASE_BRANCH} at admission | \`${pos.head}\` (${pos.position}) |`,
        `| control SHA (workflow commit) | \`${control || 'unknown'}\` |`,
        `| tag | \`${tagState}\` |`,
        `| registry | \`${st.state}\` |`,
      ].join('\n'),
    );
    if (dryRun) {
      const next =
        mode === 'new'
          ? `would tag ${tag} at ${sha} and dispatch ${PUBLISH_WORKFLOW}`
          : `would keep ${tag} at ${sha} (resume) and dispatch ${PUBLISH_WORKFLOW}`;
      ctx.out(`DRY RUN: ${next}; no tag, publish, dist-tag or Release was changed`);
      return 0;
    }
    if (mode === 'new')
      commands['create-tag'](ctx, { flags: { tag, sha, repo, 'control-sha': control } });
    else ctx.output('tag_outcome', 'exists');
    return commands['dispatch-publish'](ctx, {
      flags: { tag, repo, sha, 'control-sha': control, 'request-id': need(flags, 'request-id') },
    });
  },

  // Read-only candidate selection for a new release (or a resume). Defaults to
  // the current origin/main head; an explicit --sha is kept, never replaced.
  // Needs only git + the public registry; CI is checked when gh works, and is
  // enforced again by release.yml admission regardless.
  async candidate(ctx, { flags }) {
    const repo = flags.repo ?? DEFAULT_REPO;
    if (flags.fetch !== 'false') {
      const f = ctx.run('git', [
        'fetch',
        '--no-tags',
        'origin',
        `+refs/heads/${RELEASE_BRANCH}:refs/remotes/origin/${RELEASE_BRANCH}`,
      ]);
      if (f.code !== 0)
        throw new ReleaseError(
          'git',
          `git fetch origin ${RELEASE_BRANCH} failed: ${f.stderr.trim()}`,
        );
    }
    const head = ctx.git('rev-parse', `origin/${RELEASE_BRANCH}`);
    const basePkg = JSON.parse(ctx.git('show', `${flags.sha ?? head}:package.json`));
    const version = flags.version ?? basePkg.version;
    const tag = `v${version}`;
    const ls = ctx.run('git', [
      'ls-remote',
      '--tags',
      'origin',
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ]);
    if (ls.code !== 0)
      throw new ReleaseError('git', `cannot read remote tag ${tag}: ${ls.stderr.trim()}`);
    const refs = Object.fromEntries(
      ls.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t').reverse()),
    );
    const target = refs[`refs/tags/${tag}^{}`] ?? refs[`refs/tags/${tag}`] ?? null;
    const sha = assertSha(flags.sha ?? target ?? head);
    if (target !== null && target !== sha) {
      throw new ReleaseError(
        'tag-moved',
        `${tag} already exists at ${target}, not ${sha}. A release tag is never moved: resume with sha=${target}, or cut a new version`,
      );
    }
    const mode = target === null ? 'new' : 'resume';
    commands['admit-source'](ctx, { flags: { sha } });
    const pkgText = ctx.git('show', `${sha}:package.json`);
    commands['admit-tag'](ctx, { flags: { tag, 'package-json-text': pkgText } });
    extractReleaseNotes(ctx.git('show', `${sha}:${CHANGELOG_DIR}/v${version}.mdx`));
    const pos = mainPosition(ctx, sha);
    ctx.output('start_mode', mode);
    ctx.output('candidate_sha', sha);
    ctx.output('main_head', pos.head);
    ctx.output('candidate_position', pos.position);
    if (mode === 'new' && sha !== pos.head) {
      ctx.annotate(
        'warning',
        `candidate ${sha} is not the current origin/${RELEASE_BRANCH} head ${pos.head}; it is kept as given (never replaced)`,
      );
    }
    const st = await getVersionState(PACKAGE_NAME, version, ctx);
    ctx.output('registry_state', st.state);
    if (st.state === 'unknown')
      throw new ReleaseError('registry-unknown', `cannot determine registry state: ${st.error}`);
    if (st.state === 'published' && mode === 'new') {
      throw new ReleaseError(
        'already-published',
        `${version} is already on npm but ${tag} does not exist; not a release candidate`,
      );
    }
    // Without an explicit --sha the caller wants a release; a published version
    // is finished (bump first). Resuming finalization needs an explicit --sha.
    if (st.state === 'published' && !flags.sha) {
      throw new ReleaseError(
        'already-released',
        `${version} is already published from ${tag} at ${sha}. For a new release, bump first (RELEASING.md Step 2). To resume only provenance check + GitHub Release finalization, rerun with --sha ${sha}`,
      );
    }
    const ci = ctx.gh([
      'api',
      `repos/${repo}/actions/workflows/${CI_WORKFLOW}/runs?head_sha=${sha}&per_page=100`,
    ]);
    let ciNote;
    let runs = null;
    if (ci.code === 0) {
      try {
        runs = JSON.parse(ci.stdout).workflow_runs;
      } catch {
        runs = null;
      }
    }
    if (Array.isArray(runs)) {
      const sel = selectCiRun(runs, sha);
      ctx.output('ci_status', sel.status);
      if (sel.runId) ctx.output('ci_run_id', sel.runId);
      if (sel.status === 'refused') {
        throw new ReleaseError(
          'ci-not-green',
          `newest CI push run ${sel.runId} attempt ${sel.attempt} for ${sha} concluded ${sel.conclusion}; not a release candidate`,
        );
      }
      ciNote =
        sel.status === 'admitted' ? `green (run ${sel.runId})` : `${sel.status}: wait for green`;
    } else {
      ctx.output('ci_status', 'unchecked');
      const why =
        ci.code === 0
          ? 'unreadable response'
          : (ci.stderr ?? '').trim().split('\n')[0] || `gh exit ${ci.code}`;
      ciNote = `unchecked here (gh: ${why}): read the ${CI_WORKFLOW} push run for ${sha} with GitHub MCP or the Actions UI; release.yml admission enforces it anyway`;
    }
    const requestId =
      flags['request-id'] ??
      `rel-${version}-${sha.slice(0, 7)}-${(ctx.now ?? Date.now)().toString(36)}`;
    ctx.output('request_id', requestId);
    const inputs = { version, sha, dry_run: 'true', request_id: requestId };
    ctx.out(
      [
        `Candidate ${tag} (${mode}) at ${sha}`,
        `  origin/${RELEASE_BRANCH}: ${pos.head} (${pos.position})`,
        `  registry: ${st.state}${st.state === 'published' ? ' (resume only re-verifies provenance and finalizes the GitHub Release)' : ''}`,
        `  CI: ${ciNote}`,
        `Dispatch ${START_WORKFLOW} on ref ${RELEASE_BRANCH} with these inputs (dry run first, then dry_run=false):`,
        JSON.stringify(inputs),
        `Find the exact run: ${START_WORKFLOW} workflow_dispatch run whose title contains [${requestId}]`,
      ].join('\n'),
    );
    return 0;
  },

  // Assert the publish runtime: Node >= 22.14.0 and the pinned npm next to node.
  'assert-runtime'(ctx) {
    const [a, b, c] = ctx.nodeVersion.split('.').map(Number);
    const ok =
      a > MIN_NODE[0] ||
      (a === MIN_NODE[0] && (b > MIN_NODE[1] || (b === MIN_NODE[1] && c >= MIN_NODE[2])));
    if (!ok)
      throw new ReleaseError(
        'runtime',
        `Node ${ctx.nodeVersion} < ${MIN_NODE.join('.')} (trusted publishing minimum)`,
      );
    const r = ctx.run('npm', ['--version']);
    const v = r.stdout.trim();
    if (r.code !== 0 || v !== NPM_CLI_VERSION) {
      throw new ReleaseError(
        'runtime',
        `npm on PATH is '${v}', expected pinned ${NPM_CLI_VERSION}`,
      );
    }
    ctx.out(`node ${ctx.nodeVersion}, npm ${v}`);
    return 0;
  },

  'npm-version'(ctx) {
    ctx.out(NPM_CLI_VERSION);
    return 0;
  },

  // Non-mutating: compute the next version and categorized changes.
  plan(ctx, { flags }) {
    const pkg = readPackageJson(ctx);
    const current = pkg.version;
    const arg = flags.arg ?? '';
    // Sort semantically: git's v:refname order puts vX.Y.Z-next.N above vX.Y.Z.
    const allowed = ctx
      .git('tag', '-l', 'v*')
      .split('\n')
      .filter((t) => t && isAllowedVersion(t.slice(1)))
      .sort((x, y) => compareVersions(y.slice(1), x.slice(1)));
    const stableTags = allowed.filter((t) => !isPrerelease(t.slice(1)));
    const base = needsStableBase({ current, arg }) ? stableTags[0] : allowed[0];
    const range = base ? `${base}..HEAD` : 'HEAD';
    const sep = '\u001e';
    const raw = ctx.git('log', range, `--format=%h%x1f%s%x1f%b${sep}`);
    const commits = raw
      .split(sep)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [hash, subject, body = ''] = s.split('\u001f');
        return { hash, subject, body };
      });
    const next = computeNextVersion({
      current,
      arg,
      commits,
      lastStable: stableTags[0]?.slice(1) ?? null,
    });
    const groups = { breaking: [], feat: [], fix: [], other: [] };
    for (const c of commits) groups[categorizeCommit(c)].push(`- ${c.subject} (${c.hash})`);
    const titles = {
      breaking: 'Breaking Changes',
      feat: 'Features',
      fix: 'Bug Fixes',
      other: 'Other Changes',
    };
    const lines = [];
    if (next.noQualifyingCommits) {
      lines.push(
        `No feat: or breaking commits found since ${base ?? 'the beginning'} — proposing a patch bump. Confirm this is intended before continuing.`,
        '',
      );
    }
    lines.push(
      `Proposed bump: ${current} → ${next.version} (${next.level}, dist-tag ${next.channel}, base ${base ?? '(none)'})`,
    );
    for (const k of Object.keys(groups)) {
      if (groups[k].length) lines.push('', `${titles[k]}:`, ...groups[k]);
    }
    if (flags.json) ctx.out(JSON.stringify({ current, base, ...next, commits }, null, 2));
    else ctx.out(lines.join('\n'));
    return 0;
  },

  // Capability preflight: report what this checkout/session can actually do, by
  // path (gh CLI, GitHub MCP tools, manual UI). Never mutates anything.
  // --github-mcp yes|no records the agent's own read-only probe of its GitHub
  // MCP tools (this CLI cannot see them); omitted means unknown.
  preflight(ctx, { flags }) {
    const repo = flags.repo ?? DEFAULT_REPO;
    const rows = [];
    const add = (cap, state, note) => rows.push({ cap, state, note });
    const first = (s) =>
      String(s ?? '')
        .trim()
        .split('\n')[0];

    const ver = ctx.gh(['--version']);
    const ghInstalled = ver.code === 0;
    const auth = ghInstalled ? ctx.gh(['auth', 'status']) : null;
    const ghAuth = ghInstalled && auth.code === 0;
    add(
      'gh CLI authenticated',
      ghAuth ? 'yes' : 'no',
      !ghInstalled ? 'gh not installed' : ghAuth ? '' : first(auth.stderr || auth.stdout),
    );
    let p = null;
    let ghRuns = false;
    if (ghAuth) {
      const perm = ctx.gh(['api', `repos/${repo}`, '--jq', '.permissions']);
      if (perm.code === 0) {
        try {
          p = JSON.parse(perm.stdout);
        } catch {
          p = null;
        }
      }
      add(
        'gh: repo write (push / dispatch)',
        p ? (p.push || p.maintain || p.admin ? 'yes' : 'no') : 'unknown',
        p
          ? JSON.stringify(p)
          : perm.code === 0
            ? 'not reported for this token type'
            : first(perm.stderr),
      );
    }
    if (ghInstalled) {
      const runs = ctx.gh([
        'run',
        'list',
        '--repo',
        repo,
        '--workflow',
        START_WORKFLOW,
        '--limit',
        '1',
        '--json',
        'databaseId',
      ]);
      ghRuns = runs.code === 0;
      add(
        'gh: read Actions runs (public reads work without login)',
        ghRuns ? 'yes' : 'no',
        ghRuns ? '' : first(runs.stderr),
      );
    }
    const ghDispatch = p
      ? p.push || p.maintain || p.admin
        ? 'yes'
        : 'no'
      : ghAuth
        ? 'unknown'
        : 'no';

    const mcp = ['yes', 'no'].includes(flags['github-mcp']) ? flags['github-mcp'] : 'unknown';
    add(
      'GitHub MCP: dispatch + read Actions runs',
      mcp,
      mcp === 'unknown'
        ? 'not visible to this CLI: probe with a read-only Actions run list, then rerun with --github-mcp yes|no'
        : 'reported by the agent (--github-mcp)',
    );

    const fetch = ctx.run('git', ['ls-remote', '--heads', 'origin', RELEASE_BRANCH]);
    add(
      'git read origin',
      fetch.code === 0 ? 'yes' : 'no',
      fetch.code === 0 ? '' : first(fetch.stderr),
    );
    const push = ctx.run('git', [
      'push',
      '--dry-run',
      '--porcelain',
      'origin',
      `HEAD:refs/heads/zz-preflight-probe`,
    ]);
    add(
      'git push branch (dry-run)',
      push.code === 0 ? 'yes' : 'no',
      push.code === 0 ? 'dry-run only' : push.stderr.trim().split('\n').slice(-1)[0],
    );
    add(
      'git push tag',
      'not needed',
      `release.yml creates the tag; agent/Cloud sessions never push tags`,
    );
    const branch = ctx.run('git', ['branch', '--show-current']).stdout.trim();
    add(
      `checkout on ${RELEASE_BRANCH}`,
      branch === RELEASE_BRANCH ? 'yes' : 'no',
      branch || '(detached)',
    );
    const dirty = ctx.run('git', ['status', '--porcelain']).stdout.trim();
    add('clean working tree', dirty ? 'no' : 'yes', '');

    // gh logged in but write not reported (some token types): gh is still the
    // first thing to try, and a dry-run dispatch is the non-mutating proof.
    let initiation;
    if (ghDispatch === 'yes') initiation = 'gh';
    else if (mcp === 'yes') initiation = 'github-mcp';
    else if (ghDispatch === 'unknown') initiation = 'gh-unverified';
    else if (mcp === 'unknown') initiation = 'probe-github-mcp';
    else initiation = 'manual';
    const monitoring = ghRuns
      ? 'gh'
      : mcp === 'yes'
        ? 'github-mcp'
        : mcp === 'unknown'
          ? 'probe-github-mcp'
          : 'manual';
    const howTo = {
      gh: `dispatch ${START_WORKFLOW} with gh (RELEASING.md Step 7b)`,
      'gh-unverified': `try gh: a dry-run dispatch of ${START_WORKFLOW} proves dispatch rights without mutating anything (RELEASING.md Step 7b)`,
      'github-mcp': `dispatch ${START_WORKFLOW} with the GitHub MCP run_workflow tool (RELEASING.md Step 7b)`,
      'probe-github-mcp':
        'probe the GitHub MCP Actions tools, then rerun preflight with --github-mcp yes|no',
      manual: `hand off: the owner runs ${START_WORKFLOW} from the Actions UI with the printed inputs (RELEASING.md Step 7b)`,
    };
    const watch = {
      gh: 'gh run view / gh run watch <exact run id>',
      'github-mcp': 'GitHub MCP Actions run read tools, by exact run id',
      'probe-github-mcp': howTo['probe-github-mcp'],
      manual: 'the owner watches the run in the Actions UI',
    };
    ctx.out(
      rows.map((r) => `${r.state.padEnd(10)} ${r.cap}${r.note ? ` — ${r.note}` : ''}`).join('\n'),
    );
    ctx.out('');
    ctx.output('initiation', initiation);
    ctx.output('monitoring', monitoring);
    ctx.out(`→ release start: ${howTo[initiation]}`);
    ctx.out(`→ run monitoring: ${watch[monitoring]}`);
    return 0;
  },

  help(ctx) {
    ctx.out(`usage: node scripts/release/cli.mjs <command> [--flags]
  plan [--arg "<major|minor|patch|next [level]|stable>"] [--json]   non-mutating proposal
  preflight [--repo owner/name] [--github-mcp yes|no]               capability report (read-only)
  candidate [--sha S] [--version V] [--request-id ID] [--fetch false] fixed release SHA + dispatch inputs (read-only)
  start --sha S --version V --repo R --ref REF [--dry-run] [--request-id ID]   release.yml entry
  admit-tag --tag vX.Y.Z | admit-branch --ref R | admit-source --sha S [--tag T]
  admit-ci --sha S --repo R | registry-state --version V | verify-published --version V --sha S
  plan-publish-tag --version V | publish --version V --tag T --tarball F | await-published --version V
  cleanup-next --stable V | release-notes --version V [--out F]
  finalize --tag T --version V --notes-file F --repo R | create-tag --tag T --sha S --repo R
  dispatch-publish --tag T --repo R --request-id ID | assert-runtime | npm-version`);
    return 0;
  },
};

export async function main(argv, deps = realDeps()) {
  const ctx = makeCtx(deps);
  const [name, ...rest] = argv;
  const cmd = commands[name ?? 'help'];
  if (!cmd) {
    ctx.err(`unknown command: ${name}`);
    return 2;
  }
  try {
    return await cmd(ctx, parseArgs(rest));
  } catch (err) {
    if (err instanceof ReleaseError) {
      ctx.annotate('error', `[${err.code}] ${err.message}`);
      return err.code === 'usage' ? 2 : 1;
    }
    throw err;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
