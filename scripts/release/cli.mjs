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
  categorizeCommit,
  channelFor,
  compareVersions,
  computeNextVersion,
  decideNextCleanup,
  extractReleaseNotes,
  isAllowedVersion,
  isPrerelease,
  needsStableBase,
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
    const target = remoteTagTarget(ctx, repo, tag);
    if (target !== null) {
      if (target !== sha)
        throw new ReleaseError('tag-moved', `${tag} already exists at ${target}, not ${sha}`);
      ctx.output('tag_outcome', 'exists');
      return 0;
    }
    const mk = ctx.gh([
      'api',
      '-X',
      'POST',
      `repos/${repo}/git/refs`,
      '-f',
      `ref=refs/tags/${tag}`,
      '-f',
      `sha=${sha}`,
    ]);
    if (mk.code !== 0) throw new ReleaseError('gh', `creating ${tag} failed: ${mk.stderr.trim()}`);
    ctx.output('tag_outcome', 'created');
    return 0;
  },

  // Explicitly dispatch publish.yml on the tag ref (GITHUB_TOKEN tag pushes do not
  // trigger workflows) and return the exact run id.
  async 'dispatch-publish'(ctx, { flags }) {
    const tag = need(flags, 'tag');
    const repo = need(flags, 'repo');
    const requestId = need(flags, 'request-id');
    const r = ctx.gh([
      'api',
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
    if (r.code !== 0) throw new ReleaseError('gh', `dispatch failed: ${r.stderr.trim()}`);
    let runId = null;
    try {
      runId = JSON.parse(r.stdout || '{}').workflow_run_id ?? null;
    } catch {
      runId = null;
    }
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
    ctx.output('publish_run_id', runId);
    ctx.output('publish_run_url', `https://github.com/${repo}/actions/runs/${runId}`);
    return 0;
  },

  // Hosted release initiation (release.yml). Re-runs every admission check; with
  // --dry-run it performs reads only, otherwise it tags the admitted SHA and
  // explicitly dispatches publish.yml on that tag.
  async start(ctx, { flags }) {
    const dryRun = flags['dry-run'] === 'true';
    const sha = assertSha(need(flags, 'sha'));
    const version = need(flags, 'version');
    const repo = need(flags, 'repo');
    admitBranchRef(need(flags, 'ref'));
    const tag = `v${version}`;
    const pkgText = ctx.git('show', `${sha}:package.json`);
    commands['admit-tag'](ctx, { flags: { tag, 'package-json-text': pkgText } });
    commands['admit-source'](ctx, { flags: { sha } });
    extractReleaseNotes(ctx.git('show', `${sha}:${CHANGELOG_DIR}/v${version}.mdx`));
    await commands['admit-ci'](ctx, {
      flags: { sha, repo, tries: flags.tries, 'interval-sec': flags['interval-sec'] },
    });
    const st = await getVersionState(PACKAGE_NAME, version, ctx);
    if (st.state === 'unknown')
      throw new ReleaseError('registry-unknown', `cannot determine registry state: ${st.error}`);
    if (st.state === 'published') {
      throw new ReleaseError(
        'already-published',
        `${version} is already on npm; recover by dispatching publish.yml on ${tag} instead`,
      );
    }
    await commands['plan-publish-tag'](ctx, { flags: { version } });
    const target = remoteTagTarget(ctx, repo, tag);
    if (target !== null && target !== sha) {
      throw new ReleaseError('tag-moved', `${tag} already exists at ${target}, not ${sha}`);
    }
    const tagState = target === null ? 'absent' : 'exists-same-sha';
    ctx.output('tag_state', tagState);
    ctx.summary(
      `- release ${tag} at \`${sha}\`: admitted (${dryRun ? 'dry-run, nothing mutated' : 'starting'})`,
    );
    if (dryRun) {
      ctx.out(
        `DRY RUN: would tag ${tag} at ${sha} (${tagState}) and dispatch ${PUBLISH_WORKFLOW}; no tag, publish, dist-tag or Release was changed`,
      );
      return 0;
    }
    commands['create-tag'](ctx, { flags: { tag, sha, repo } });
    return commands['dispatch-publish'](ctx, {
      flags: { tag, repo, 'request-id': need(flags, 'request-id') },
    });
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

  // Capability preflight: report what this checkout/session can actually do.
  preflight(ctx, { flags }) {
    const repo = flags.repo ?? 'Takazudo/zudo-design-token-lint';
    const rows = [];
    const add = (cap, state, note) => rows.push({ cap, state, note });
    const auth = ctx.gh(['auth', 'status']);
    add(
      'gh authenticated',
      auth.code === 0 ? 'yes' : 'no',
      auth.code === 0 ? '' : auth.stderr.trim().split('\n')[0],
    );
    const perm = ctx.gh(['api', `repos/${repo}`, '--jq', '.permissions']);
    let p = null;
    if (perm.code === 0) {
      try {
        p = JSON.parse(perm.stdout);
      } catch {
        p = null;
      }
    }
    if (!p)
      add(
        'repo permissions',
        'unknown',
        perm.code === 0 ? 'not reported for this token type' : perm.stderr.trim().split('\n')[0],
      );
    else
      add(
        'repo write (push / tag / dispatch)',
        p.push || p.maintain || p.admin ? 'yes' : 'no',
        JSON.stringify(p),
      );
    const runs = ctx.gh([
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      PUBLISH_WORKFLOW,
      '--limit',
      '1',
      '--json',
      'databaseId',
    ]);
    add(
      'read Actions runs (monitoring)',
      runs.code === 0 ? 'yes' : 'no',
      runs.code === 0 ? '' : runs.stderr.trim().split('\n')[0],
    );
    const push = ctx.run('git', [
      'push',
      '--dry-run',
      '--porcelain',
      'origin',
      `HEAD:refs/heads/zz-preflight-probe`,
    ]);
    add(
      'git push over remote (dry-run)',
      push.code === 0 ? 'yes' : 'no',
      push.code === 0 ? 'dry-run only' : push.stderr.trim().split('\n').slice(-1)[0],
    );
    const branch = ctx.run('git', ['branch', '--show-current']).stdout.trim();
    add(
      `checkout on ${RELEASE_BRANCH}`,
      branch === RELEASE_BRANCH ? 'yes' : 'no',
      branch || '(detached)',
    );
    const dirty = ctx.run('git', ['status', '--porcelain']).stdout.trim();
    add('clean working tree', dirty ? 'no' : 'yes', '');
    add(
      'Release start via release.yml',
      p ? (p.push || p.maintain || p.admin ? 'yes' : 'no') : 'unknown',
      'needs Actions write (workflow dispatch)',
    );
    ctx.out(
      rows.map((r) => `${r.state.padEnd(8)} ${r.cap}${r.note ? ` — ${r.note}` : ''}`).join('\n'),
    );
    return 0;
  },

  help(ctx) {
    ctx.out(`usage: node scripts/release/cli.mjs <command> [--flags]
  plan [--arg "<major|minor|patch|next [level]|stable>"] [--json]   non-mutating proposal
  preflight [--repo owner/name]                                     capability report
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
