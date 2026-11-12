'use client';

// The "use client" directive marks this as a hydrating island so zfb's scanner
// registers it in the island manifest. Interactive state uses zudo-react's
// setup-time signals: the component body runs ONCE per scope, so every value
// that changes is a signal/computed read by the JSX, never a render snapshot.
import { computed, For, getScope, Show, signal } from '@takazudo/zfb/zudo-react';
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
  if (parsed.css !== undefined && (typeof parsed.css !== 'object' || parsed.css === null || Array.isArray(parsed.css)))
    throw new Error('"css" must be an object');
  return {
    prohibited: parsed.prohibited ?? [],
    allowed: parsed.allowed ?? [],
    ignore: parsed.ignore ?? [],
    suggestionSuffix: parsed.suggestionSuffix,
    suggestions: parsed.suggestions,
    semanticPrefixes: parsed.semanticPrefixes,
    css: parsed.css,
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

// Compute initial lint results at module load (not inside setup)
const INITIAL_LINT = runLintSync(DEFAULT_CODE, DEFAULT_CONFIG);

const LINT_DEBOUNCE_MS = 300;

export default function Playground({ lang = 'en' }: { lang?: PlaygroundLang }) {
  const t = UI_LABELS[lang] ?? UI_LABELS.en;
  const scope = getScope();
  const code = signal(DEFAULT_CODE);
  const configStr = signal(DEFAULT_CONFIG);
  const results = signal<LintResult[]>(INITIAL_LINT.results);
  const configError = signal<string | null>(INITIAL_LINT.configError);

  const hasConfigError = computed(() => configError.value !== null);
  const hasNoResults = computed(() => results.value.length === 0);
  const keyedResults = computed(() =>
    results.value.map((r, i) => ({ ...r, key: `${r.line}-${r.className}-${i}` })),
  );

  function applyLint(codeVal: string, configVal: string) {
    const { results: r, configError: err } = runLintSync(codeVal, configVal);
    results.value = r;
    configError.value = err;
  }

  // Debounced re-lint on edit. The first run only subscribes: the initial
  // results were already computed at module load.
  let isFirstRun = true;
  scope.effect(() => {
    const codeVal = code.value;
    const configVal = configStr.value;
    if (isFirstRun) {
      isFirstRun = false;
      return;
    }
    const timer = setTimeout(() => applyLint(codeVal, configVal), LINT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  return (
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-hsp-lg">
      {/* Left panel: Code + Config */}
      <div class="flex flex-col gap-vsp-sm">
        <div class="flex flex-col gap-vsp-2xs">
          <label for="pg-code" class="text-caption font-semibold text-muted">
            {t.code}
          </label>
          <textarea
            id="pg-code"
            modelValue={code}
            class={TEXTAREA_CLASS}
            rows={7}
            spellcheck={false}
          />
        </div>
        <div class="flex flex-col gap-vsp-2xs">
          <label for="pg-config" class="text-caption font-semibold text-muted">
            {t.configuration}
          </label>
          <textarea
            id="pg-config"
            modelValue={configStr}
            class={TEXTAREA_CLASS}
            rows={14}
            spellcheck={false}
          />
          <Show when={hasConfigError}>
            {() => (
              <p class="text-caption text-danger">
                {t.configErrorPrefix} {computed(() => configError.value ?? '')}
              </p>
            )}
          </Show>
        </div>
        <button
          type="button"
          on:click={() => applyLint(code.value, configStr.value)}
          class="self-start rounded-lg border border-accent bg-accent/10 px-hsp-lg py-vsp-2xs text-caption font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          {t.lintButton}
        </button>
      </div>

      {/* Right panel: Results */}
      <div class="flex flex-col gap-vsp-2xs">
        <span class="text-caption font-semibold text-muted">
          {t.results}
          <Show when={computed(() => !hasConfigError.value)}>
            {() => (
              <span class="ml-hsp-xs font-normal">
                {computed(() => t.violationCount(results.value.length))}
              </span>
            )}
          </Show>
        </span>
        <div
          class="min-h-[10rem] rounded-lg border border-muted/30 bg-surface/50 p-hsp-md overflow-y-auto"
          aria-live="polite"
        >
          <Show
            when={hasConfigError}
            fallback={() => (
              <Show
                when={hasNoResults}
                fallback={() => (
                  <ul class="flex flex-col gap-vsp-xs list-none p-0 m-0">
                    <For each={keyedResults} by={(r) => r.key}>
                      {(item) => {
                        const r = item.value;
                        return (
                          <li class="flex flex-col gap-vsp-2xs border-b border-muted/20 pb-vsp-xs last:border-b-0">
                            <div class="flex items-baseline gap-hsp-sm flex-wrap">
                              <span class="text-caption text-muted whitespace-nowrap">
                                {t.line(r.line)}
                              </span>
                              <code class="rounded bg-code-bg px-hsp-xs py-px font-mono text-caption text-danger font-medium">
                                {r.className}
                              </code>
                            </div>
                            <p class="text-caption text-muted m-0">
                              {computed(() => item.value.reason)}
                            </p>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                )}
              >
                {() => <p class="text-caption text-success">{t.noViolations}</p>}
              </Show>
            )}
          >
            {() => <p class="text-caption text-danger italic">{t.fixConfigError}</p>}
          </Show>
        </div>
      </div>
    </div>
  );
}

// Pin the island marker name so it survives minification; zfb reads
// displayName for the island identity (must equal the function name).
Playground.displayName = 'Playground';
