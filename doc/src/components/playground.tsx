'use client';

// preact/compat is imported by its real specifier, NOT through the "react"
// tsconfig alias: zfb 1.1.1's bundler consults the tsconfig `paths` entry
// (react → ./node_modules/preact/compat/) ahead of its own framework alias and
// cannot resolve that bare directory target, failing the build with "matched a
// first-party mapping but no target resolved". Naming the package directly
// resolves through preact's exports map and keeps this file's original typing
// surface — plain preact/hooks would retype the JSX against @types/react,
// where `spellcheck` must be spelled `spellCheck`, which preact then drops from
// the DOM instead of setting. The "use client" directive marks this as a
// hydrating island so zfb's scanner registers it in the island manifest (the
// marker name is pinned in src/chrome-bindings.tsx).
import { useState, useRef, useEffect } from 'preact/compat';
import { compileConfig, lintContent, type LintConfig, type LintResult } from '@/lib/lint-browser';
import { DEFAULT_CODE, DEFAULT_CONFIG } from '@/lib/playground-samples';

const TEXTAREA_CLASS =
  'min-h-[10rem] w-full resize-y rounded-lg border border-muted/30 bg-code-bg p-hsp-md font-mono text-caption leading-relaxed text-code-fg focus:border-accent focus:outline-none';

// UI chrome labels per locale. Only `lang` (a plain string) crosses the
// island SSR→hydration prop boundary — label lookup happens inside the
// component so nothing non-serializable rides the island props.
export type PlaygroundLang = 'en' | 'ja';

const UI_LABELS: Record<
  PlaygroundLang,
  {
    code: string;
    configuration: string;
    configErrorPrefix: string;
    lintButton: string;
    results: string;
    violationCount: (n: number) => string;
    fixConfigError: string;
    noViolations: string;
    line: (n: number) => string;
  }
> = {
  en: {
    code: 'Code',
    configuration: 'Configuration',
    configErrorPrefix: 'Config error:',
    lintButton: 'Lint',
    results: 'Results',
    violationCount: (n) => `(${n} violation${n !== 1 ? 's' : ''})`,
    fixConfigError: 'Fix the configuration error to see results.',
    noViolations: 'No violations found.',
    line: (n) => `Line ${n}`,
  },
  ja: {
    code: 'コード',
    configuration: '設定',
    configErrorPrefix: '設定エラー:',
    lintButton: 'Lint 実行',
    results: '結果',
    violationCount: (n) => `(違反 ${n} 件)`,
    fixConfigError: '設定エラーを修正すると結果が表示されます。',
    noViolations: '違反はありません。',
    line: (n) => `${n} 行目`,
  },
};

function parseLintConfig(configStr: string): LintConfig {
  const parsed = JSON.parse(configStr);
  if (parsed.prohibited && !Array.isArray(parsed.prohibited))
    throw new Error('"prohibited" must be an array');
  if (parsed.allowed && !Array.isArray(parsed.allowed))
    throw new Error('"allowed" must be an array');
  if (parsed.ignore && !Array.isArray(parsed.ignore)) throw new Error('"ignore" must be an array');
  if (
    parsed.suggestions &&
    (typeof parsed.suggestions !== 'object' || Array.isArray(parsed.suggestions))
  )
    throw new Error('"suggestions" must be an object');
  if (parsed.semanticPrefixes && !Array.isArray(parsed.semanticPrefixes))
    throw new Error('"semanticPrefixes" must be an array');
  return {
    prohibited: parsed.prohibited ?? [],
    allowed: parsed.allowed ?? [],
    ignore: parsed.ignore ?? [],
    suggestionSuffix: parsed.suggestionSuffix,
    suggestions: parsed.suggestions,
    semanticPrefixes: parsed.semanticPrefixes,
  };
}

function runLintSync(
  code: string,
  configStr: string,
): {
  results: LintResult[];
  configError: string | null;
} {
  let config: LintConfig;
  try {
    config = parseLintConfig(configStr);
  } catch (e) {
    return {
      results: [],
      configError: e instanceof Error ? e.message : 'Invalid JSON',
    };
  }
  try {
    const compiled = compileConfig(config);
    return { results: lintContent(code, compiled), configError: null };
  } catch (e) {
    return {
      results: [],
      configError: e instanceof Error ? e.message : 'Lint error',
    };
  }
}

// Compute initial lint results at module load (not inside render)
const INITIAL_LINT = runLintSync(DEFAULT_CODE, DEFAULT_CONFIG);

export default function Playground({ lang = 'en' }: { lang?: PlaygroundLang }) {
  const t = UI_LABELS[lang] ?? UI_LABELS.en;
  const [code, setCode] = useState(DEFAULT_CODE);
  const [configStr, setConfigStr] = useState(DEFAULT_CONFIG);
  const [results, setResults] = useState<LintResult[]>(INITIAL_LINT.results);
  const [configError, setConfigError] = useState<string | null>(INITIAL_LINT.configError);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);

  function applyLint(codeVal: string, configVal: string) {
    const { results: r, configError: err } = runLintSync(codeVal, configVal);
    setResults(r);
    setConfigError(err);
  }

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => applyLint(code, configStr), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [code, configStr]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-hsp-lg">
      {/* Left panel: Code + Config */}
      <div className="flex flex-col gap-vsp-sm">
        <div className="flex flex-col gap-vsp-2xs">
          <label htmlFor="pg-code" className="text-caption font-semibold text-muted">
            {t.code}
          </label>
          <textarea
            id="pg-code"
            value={code}
            onInput={(e) => setCode((e.target as HTMLTextAreaElement).value)}
            className={TEXTAREA_CLASS}
            rows={7}
            spellcheck={false}
          />
        </div>
        <div className="flex flex-col gap-vsp-2xs">
          <label htmlFor="pg-config" className="text-caption font-semibold text-muted">
            {t.configuration}
          </label>
          <textarea
            id="pg-config"
            value={configStr}
            onInput={(e) => setConfigStr((e.target as HTMLTextAreaElement).value)}
            className={TEXTAREA_CLASS}
            rows={14}
            spellcheck={false}
          />
          {configError && (
            <p className="text-caption text-danger">
              {t.configErrorPrefix} {configError}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => applyLint(code, configStr)}
          className="self-start rounded-lg border border-accent bg-accent/10 px-hsp-lg py-vsp-2xs text-caption font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          {t.lintButton}
        </button>
      </div>

      {/* Right panel: Results */}
      <div className="flex flex-col gap-vsp-2xs">
        <span className="text-caption font-semibold text-muted">
          {t.results}
          {!configError && (
            <span className="ml-hsp-xs font-normal">{t.violationCount(results.length)}</span>
          )}
        </span>
        <div
          className="min-h-[10rem] rounded-lg border border-muted/30 bg-surface/50 p-hsp-md overflow-y-auto"
          aria-live="polite"
        >
          {configError ? (
            <p className="text-caption text-danger italic">{t.fixConfigError}</p>
          ) : results.length === 0 ? (
            <p className="text-caption text-success">{t.noViolations}</p>
          ) : (
            <ul className="flex flex-col gap-vsp-xs list-none p-0 m-0">
              {results.map((r, i) => (
                <li
                  key={`${r.line}-${r.className}-${i}`}
                  className="flex flex-col gap-vsp-2xs border-b border-muted/20 pb-vsp-xs last:border-b-0"
                >
                  <div className="flex items-baseline gap-hsp-sm flex-wrap">
                    <span className="text-caption text-muted whitespace-nowrap">
                      {t.line(r.line)}
                    </span>
                    <code className="rounded bg-code-bg px-hsp-xs py-px font-mono text-caption text-danger font-medium">
                      {r.className}
                    </code>
                  </div>
                  <p className="text-caption text-muted m-0">{r.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
