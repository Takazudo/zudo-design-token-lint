// Pure release-policy functions shared by the release CLI, the GitHub Actions
// workflows and the tests. No I/O here: callers inject registry/git/gh data.

export const PACKAGE_NAME = '@takazudo/zudo-design-token-lint';
export const RELEASE_BRANCH = 'main';
export const PRERELEASE_IDS = ['next', 'beta', 'rc'];

const NUM = '(0|[1-9]\\d*)';
const VERSION_RE = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}(?:-(next|beta|rc)\\.${NUM})?$`);
const TAG_RE = new RegExp(`^v(${NUM}\\.${NUM}\\.${NUM}(?:-(?:next|beta|rc)\\.${NUM})?)$`);
const SHA_RE = /^[0-9a-f]{40}$/;

export class ReleaseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function parseVersion(version) {
  const m = VERSION_RE.exec(String(version));
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    preId: m[4] ?? null,
    preNum: m[5] === undefined ? null : Number(m[5]),
  };
}

export function isAllowedVersion(version) {
  return parseVersion(version) !== null;
}

export function isPrerelease(version) {
  const p = parseVersion(version);
  if (!p) throw new ReleaseError('bad-version', `not an allowed release version: ${version}`);
  return p.preId !== null;
}

export function channelFor(version) {
  return isPrerelease(version) ? 'next' : 'latest';
}

// SemVer precedence restricted to the allowed grammar (one prerelease id + number).
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new ReleaseError('bad-version', `cannot compare ${a} and ${b}`);
  for (const k of ['major', 'minor', 'patch']) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  if (x.preId === null && y.preId === null) return 0;
  if (x.preId === null) return 1;
  if (y.preId === null) return -1;
  if (x.preId !== y.preId) return x.preId < y.preId ? -1 : 1;
  if (x.preNum !== y.preNum) return x.preNum < y.preNum ? -1 : 1;
  return 0;
}

// Generic SemVer comparison for registry values we did not author (a dist-tag
// could point at any version shape). Returns null when either side is unparseable.
export function compareAnySemver(a, b) {
  const re = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
  const ma = re.exec(String(a));
  const mb = re.exec(String(b));
  if (!ma || !mb) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  const pa = ma[4];
  const pb = mb[4];
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  const xa = pa.split('.');
  const xb = pb.split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb && Number(xa[i]) !== Number(xb[i])) return Number(xa[i]) < Number(xb[i]) ? -1 : 1;
    if (na !== nb) return na ? -1 : 1;
    if (!na && xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}

// Tag admission: exact grammar, exact package name, tag == "v" + package.json version.
export function admitTag({ tag, packageJson }) {
  const m = TAG_RE.exec(String(tag ?? ''));
  if (!m) {
    throw new ReleaseError(
      'bad-tag',
      `tag '${tag}' is not an allowed release tag (v<MAJOR>.<MINOR>.<PATCH>[-(next|beta|rc).<N>], no leading zeros)`,
    );
  }
  const version = m[1];
  if (packageJson?.name !== PACKAGE_NAME) {
    throw new ReleaseError(
      'bad-package',
      `package.json name '${packageJson?.name}' is not ${PACKAGE_NAME}`,
    );
  }
  if (packageJson.version !== version) {
    throw new ReleaseError(
      'version-mismatch',
      `tag ${tag} does not match package.json version '${packageJson.version}'`,
    );
  }
  return { tag, version, channel: channelFor(version), prerelease: isPrerelease(version) };
}

export function assertSha(sha) {
  if (!SHA_RE.test(String(sha))) {
    throw new ReleaseError('bad-sha', `expected a full 40-char lowercase commit SHA, got '${sha}'`);
  }
  return sha;
}

// Refuse anything but the release branch for workflows that start a release.
export function admitBranchRef(ref) {
  if (ref !== `refs/heads/${RELEASE_BRANCH}`) {
    throw new ReleaseError(
      'bad-branch',
      `must run from refs/heads/${RELEASE_BRANCH}, not '${ref}'`,
    );
  }
  return true;
}

// Pick CI evidence for exactly `sha` from a list of GitHub workflow runs.
export function selectCiRun(runs, sha) {
  const mine = (runs ?? []).filter(
    (r) => r.head_sha === sha && r.event === 'push' && r.head_branch === RELEASE_BRANCH,
  );
  const ok = mine.filter((r) => r.status === 'completed' && r.conclusion === 'success');
  if (ok.length > 0) {
    const run = ok.reduce((a, b) => (b.id > a.id ? b : a));
    return {
      status: 'admitted',
      runId: run.id,
      attempt: run.run_attempt,
      url: run.html_url,
    };
  }
  if (mine.some((r) => r.status !== 'completed')) return { status: 'pending' };
  if (mine.length === 0) return { status: 'missing' };
  const latest = mine.reduce((a, b) => (b.id > a.id ? b : a));
  return {
    status: 'refused',
    runId: latest.id,
    attempt: latest.run_attempt,
    conclusion: latest.conclusion,
    url: latest.html_url,
  };
}

// Decide what to publish under, without regressing an existing dist-tag.
export function planPublishTag({ version, distTags }) {
  const tag = channelFor(version);
  const current = distTags?.[tag];
  if (current) {
    const c = compareAnySemver(version, current);
    if (c === null) {
      throw new ReleaseError(
        'dist-tag-unknown',
        `cannot compare ${version} with ${tag}=${current}`,
      );
    }
    if (c <= 0) {
      throw new ReleaseError(
        'stale-release',
        `refusing to publish ${version} to '${tag}': it currently points at ${current} (would regress)`,
      );
    }
  }
  if (tag === 'next' && distTags?.latest) {
    const c = compareAnySemver(version, distTags.latest);
    if (c !== null && c <= 0) {
      throw new ReleaseError(
        'stale-release',
        `refusing to publish prerelease ${version}: it is not newer than latest=${distTags.latest}`,
      );
    }
  }
  return { tag, previous: current ?? null };
}

// Stale-`next` cleanup decision. Called twice: first read, then immediate recheck.
export function decideNextCleanup({ stableVersion, next }) {
  if (isPrerelease(stableVersion)) return { action: 'skip', outcome: 'noop-prerelease' };
  if (!next) return { action: 'skip', outcome: 'noop-absent' };
  const c = compareAnySemver(next, stableVersion);
  if (c === null) return { action: 'skip', outcome: 'noop-unparseable' };
  if (c >= 0) return { action: 'skip', outcome: 'noop-not-stale' };
  return { action: 'remove', outcome: 'remove' };
}

// Release-notes body = changelog MDX minus its frontmatter.
export function extractReleaseNotes(mdx) {
  const lines = String(mdx).split(/\r?\n/);
  if (lines[0] !== '---') throw new ReleaseError('bad-notes', 'changelog has no frontmatter');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new ReleaseError('bad-notes', 'changelog frontmatter is not closed');
  const body = lines
    .slice(end + 1)
    .join('\n')
    .trim();
  if (!body) throw new ReleaseError('bad-notes', 'changelog body is empty');
  return `${body}\n`;
}

const norm = (s) =>
  String(s ?? '')
    .replace(/\r\n/g, '\n')
    .trim();

// Compare an existing GitHub Release with what we would create.
export function planFinalization({ existing, expected }) {
  if (!existing) return { action: 'create' };
  const conflicts = [];
  if (existing.tagName !== expected.tag) conflicts.push(`tag ${existing.tagName}`);
  if (norm(existing.name) !== norm(expected.title)) conflicts.push(`title '${existing.name}'`);
  if (Boolean(existing.isPrerelease) !== expected.prerelease) {
    conflicts.push(`prerelease=${existing.isPrerelease}`);
  }
  if (norm(existing.body) !== norm(expected.notes)) conflicts.push('notes differ');
  if (conflicts.length) return { action: 'conflict', conflicts };
  if (existing.isDraft) return { action: 'publish-draft' };
  return { action: 'noop' };
}

// ── Version selection (stable-by-default; `next` is opt-in) ─────────────────

export function categorizeCommit({ subject, body = '' }) {
  if (/^[a-z]+(\([^)]*\))?!:/.test(subject) || /(^|\n)BREAKING[ -]CHANGE:/.test(body)) {
    return 'breaking';
  }
  if (/^feat(\([^)]*\))?:/.test(subject)) return 'feat';
  if (/^fix(\([^)]*\))?:/.test(subject)) return 'fix';
  return 'other';
}

export function judgeLevel(commits) {
  const cats = commits.map(categorizeCommit);
  if (cats.includes('breaking')) return 'major';
  if (cats.includes('feat')) return 'minor';
  return 'patch';
}

function bumpTriple({ major, minor, patch }, level) {
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// Base-tag rule: no-arg promotion from a prerelease analyses from the last STABLE tag.
export function needsStableBase({ current, arg }) {
  return isPrerelease(current) && !arg;
}

// arg: '' | 'major' | 'minor' | 'patch' | 'next' | 'next major|minor|patch' | 'stable'
// commits: commits since the base tag (see needsStableBase) with subject + body.
// lastStable: newest stable version tag (without 'v'), used for no-arg promotion.
export function computeNextVersion({ current, arg = '', commits = [], lastStable = null }) {
  const p = parseVersion(current);
  if (!p) throw new ReleaseError('bad-version', `current version ${current} is not allowed`);
  const words = String(arg).trim().split(/\s+/).filter(Boolean);
  const levels = ['major', 'minor', 'patch'];
  const judged = judgeLevel(commits);
  const noQualifying = !commits.some((c) => ['breaking', 'feat'].includes(categorizeCommit(c)));
  let version;
  let level = judged;
  if (words.length === 0) {
    if (p.preId === null) {
      version = bumpTriple(p, judged);
    } else {
      // Promote: the prerelease triple, escalated if commits since the last stable demand it.
      const triple = `${p.major}.${p.minor}.${p.patch}`;
      const base = lastStable ? parseVersion(lastStable) : null;
      const candidate = base ? bumpTriple(base, judged) : triple;
      version = compareVersions(candidate, triple) > 0 ? candidate : triple;
    }
  } else if (words.length === 1 && levels.includes(words[0])) {
    level = words[0];
    version = bumpTriple(p, level);
  } else if (words[0] === 'next' && words.length <= 2) {
    if (words.length === 2) {
      if (!levels.includes(words[1])) throw new ReleaseError('bad-arg', `unknown argument: ${arg}`);
      level = words[1];
      version = `${bumpTriple(p, level)}-next.1`;
    } else if (p.preId === 'next') {
      version = `${p.major}.${p.minor}.${p.patch}-next.${p.preNum + 1}`;
      level = 'continue';
    } else if (p.preId === null) {
      version = `${bumpTriple(p, judged)}-next.1`;
    } else {
      throw new ReleaseError('bad-arg', `cannot continue a -${p.preId} line with 'next'`);
    }
  } else if (words.length === 1 && words[0] === 'stable') {
    if (p.preId === null) throw new ReleaseError('already-stable', `${current} is already stable`);
    version = `${p.major}.${p.minor}.${p.patch}`;
    level = 'promote';
  } else {
    throw new ReleaseError('bad-arg', `unknown argument: ${arg}`);
  }
  if (compareVersions(version, current) <= 0) {
    throw new ReleaseError('not-greater', `${version} is not greater than ${current}`);
  }
  return {
    version,
    level,
    channel: channelFor(version),
    noQualifyingCommits: words.length === 0 && noQualifying,
  };
}
