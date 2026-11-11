// Exact npm registry reads with bounded retries. Every read resolves to an
// explicit state; transport failures become `unknown` (never `absent`), and the
// first and last original errors are preserved for the report.

export const REGISTRY = 'https://registry.npmjs.org';

const encodeName = (name) => name.replace('/', '%2f');

function describe(err) {
  return err?.message ?? String(err);
}

// -> { kind: 'ok', json } | { kind: 'not-found' } | { kind: 'error', errors: string[] }
export async function readJson(url, deps, { attempts = 4, delayMs = 3000 } = {}) {
  const errors = [];
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await deps.fetch(url, {
        headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      });
      if (res.status === 200) return { kind: 'ok', json: await res.json() };
      if (res.status === 404) return { kind: 'not-found' };
      errors.push(`HTTP ${res.status} from ${url}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      errors.push(`${describe(err)} (${url})`);
    }
    if (i < attempts) await deps.sleep(delayMs * i);
  }
  return { kind: 'error', errors };
}

const keepErrors = (errors) =>
  errors.length <= 2 ? errors : [errors[0], `… ${errors.length - 2} more …`, errors.at(-1)];

// -> { state: 'published' | 'absent' | 'unknown', error? }
export async function getVersionState(name, version, deps, opts) {
  const r = await readJson(`${REGISTRY}/${encodeName(name)}/${version}`, deps, opts);
  if (r.kind === 'ok') {
    if (r.json?.version === version) return { state: 'published' };
    return { state: 'unknown', error: `registry returned version '${r.json?.version}'` };
  }
  if (r.kind === 'not-found') return { state: 'absent' };
  return { state: 'unknown', error: keepErrors(r.errors).join(' | ') };
}

// -> { state: 'ok', tags } | { state: 'unknown', error }
export async function getDistTags(name, deps, opts) {
  const r = await readJson(`${REGISTRY}/-/package/${encodeName(name)}/dist-tags`, deps, opts);
  if (r.kind === 'ok' && r.json && typeof r.json === 'object') return { state: 'ok', tags: r.json };
  if (r.kind === 'not-found') return { state: 'ok', tags: {} };
  return {
    state: 'unknown',
    error: r.kind === 'error' ? keepErrors(r.errors).join(' | ') : 'bad body',
  };
}

// SLSA provenance of a published version.
// -> { state: 'ok', commit, ref, workflow } | { state: 'none' } | { state: 'unknown', error }
export async function getProvenance(name, version, deps, opts) {
  const r = await readJson(
    `${REGISTRY}/-/npm/v1/attestations/${encodeName(name)}@${version}`,
    deps,
    opts,
  );
  if (r.kind === 'not-found') return { state: 'none' };
  if (r.kind === 'error') return { state: 'unknown', error: keepErrors(r.errors).join(' | ') };
  try {
    const att = (r.json?.attestations ?? []).find(
      (a) => a.predicateType === 'https://slsa.dev/provenance/v1',
    );
    if (!att) return { state: 'none' };
    const stmt = JSON.parse(
      Buffer.from(att.bundle.dsseEnvelope.payload, 'base64').toString('utf8'),
    );
    const bd = stmt.predicate?.buildDefinition;
    const dep = bd?.resolvedDependencies?.[0];
    return {
      state: 'ok',
      commit: dep?.digest?.gitCommit ?? null,
      ref: bd?.externalParameters?.workflow?.ref ?? null,
      workflow: bd?.externalParameters?.workflow?.path ?? null,
      repository: bd?.externalParameters?.workflow?.repository ?? null,
    };
  } catch (err) {
    return { state: 'unknown', error: `cannot parse attestation: ${describe(err)}` };
  }
}

// Poll until `probe()` returns a value accepted by `done`, bounded by `tries`.
export async function poll(probe, done, deps, { tries = 10, delayMs = 15000 } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    last = await probe();
    if (done(last)) return { ok: true, value: last, tries: i };
    if (i < tries) await deps.sleep(delayMs);
  }
  return { ok: false, value: last, tries };
}
