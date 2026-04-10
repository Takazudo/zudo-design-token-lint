import { useState, useRef, useEffect } from "react";
import {
  compileConfig,
  lintContent,
  type LintConfig,
  type LintResult,
} from "@/lib/lint-browser";

const DEFAULT_CODE = `<div className="p-4 bg-gray-200">
  <h1 className="text-xl mb-vsp-md">Title</h1>
  <p className="mt-2 text-gray-600">
    Some content here
  </p>
</div>`;

const DEFAULT_CONFIG = JSON.stringify(
  {
    prohibited: [
      "p-{n}",
      "py-{n}",
      "px-{n}",
      "pt-{n}",
      "pb-{n}",
      "pl-{n}",
      "pr-{n}",
      "m-{n}",
      "my-{n}",
      "mx-{n}",
      "mt-{n}",
      "mb-{n}",
      "ml-{n}",
      "mr-{n}",
      "gap-{n}",
      "gap-x-{n}",
      "gap-y-{n}",
      "bg-{color}-{shade}",
      "text-{color}-{shade}",
      "border-{color}-{shade}",
    ],
    allowed: ["p-0", "m-0", "gap-0"],
  },
  null,
  2,
);

const TEXTAREA_CLASS =
  "min-h-40 w-full resize-y rounded-lg border border-muted/30 bg-code-bg p-hsp-md font-mono text-caption leading-relaxed text-code-fg focus:border-accent focus:outline-none";

function parseLintConfig(configStr: string): LintConfig {
  const parsed = JSON.parse(configStr);
  if (parsed.prohibited && !Array.isArray(parsed.prohibited))
    throw new Error('"prohibited" must be an array');
  if (parsed.allowed && !Array.isArray(parsed.allowed))
    throw new Error('"allowed" must be an array');
  if (parsed.ignore && !Array.isArray(parsed.ignore))
    throw new Error('"ignore" must be an array');
  return {
    prohibited: parsed.prohibited ?? [],
    allowed: parsed.allowed ?? [],
    ignore: parsed.ignore ?? [],
    suggestionSuffix: parsed.suggestionSuffix,
  };
}

function runLintSync(code: string, configStr: string): {
  results: LintResult[];
  configError: string | null;
} {
  let config: LintConfig;
  try {
    config = parseLintConfig(configStr);
  } catch (e) {
    return {
      results: [],
      configError: e instanceof Error ? e.message : "Invalid JSON",
    };
  }
  try {
    const compiled = compileConfig(config);
    return { results: lintContent(code, compiled), configError: null };
  } catch (e) {
    return {
      results: [],
      configError: e instanceof Error ? e.message : "Lint error",
    };
  }
}

// Compute initial lint results at module load (not inside render)
const INITIAL_LINT = runLintSync(DEFAULT_CODE, DEFAULT_CONFIG);

export default function Playground() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [configStr, setConfigStr] = useState(DEFAULT_CONFIG);
  const [results, setResults] = useState<LintResult[]>(INITIAL_LINT.results);
  const [configError, setConfigError] = useState<string | null>(
    INITIAL_LINT.configError,
  );
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
          <label
            htmlFor="pg-code"
            className="text-caption font-semibold text-muted"
          >
            Code
          </label>
          <textarea
            id="pg-code"
            value={code}
            onInput={(e) =>
              setCode((e.target as HTMLTextAreaElement).value)
            }
            className={TEXTAREA_CLASS}
            rows={7}
            spellCheck={false}
          />
        </div>
        <div className="flex flex-col gap-vsp-2xs">
          <label
            htmlFor="pg-config"
            className="text-caption font-semibold text-muted"
          >
            Configuration
          </label>
          <textarea
            id="pg-config"
            value={configStr}
            onInput={(e) =>
              setConfigStr((e.target as HTMLTextAreaElement).value)
            }
            className={TEXTAREA_CLASS}
            rows={14}
            spellCheck={false}
          />
          {configError && (
            <p className="text-caption text-danger">
              Config error: {configError}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => applyLint(code, configStr)}
          className="self-start rounded-lg border border-accent bg-accent/10 px-hsp-lg py-vsp-2xs text-caption font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          Lint
        </button>
      </div>

      {/* Right panel: Results */}
      <div className="flex flex-col gap-vsp-2xs">
        <span className="text-caption font-semibold text-muted">
          Results
          {!configError && (
            <span className="ml-hsp-xs font-normal">
              ({results.length} violation
              {results.length !== 1 ? "s" : ""})
            </span>
          )}
        </span>
        <div className="min-h-40 rounded-lg border border-muted/30 bg-surface/50 p-hsp-md overflow-y-auto" aria-live="polite">
          {configError ? (
            <p className="text-caption text-danger italic">
              Fix the configuration error to see results.
            </p>
          ) : results.length === 0 ? (
            <p className="text-caption text-success">
              No violations found.
            </p>
          ) : (
            <ul className="flex flex-col gap-vsp-xs list-none p-0 m-0">
              {results.map((r, i) => (
                <li
                  key={`${r.line}-${r.className}-${i}`}
                  className="flex flex-col gap-vsp-2xs border-b border-muted/20 pb-vsp-xs last:border-b-0"
                >
                  <div className="flex items-baseline gap-hsp-sm flex-wrap">
                    <span className="text-caption text-muted whitespace-nowrap">
                      Line {r.line}
                    </span>
                    <code className="rounded bg-code-bg px-hsp-xs py-px font-mono text-caption text-danger font-medium">
                      {r.className}
                    </code>
                  </div>
                  <p className="text-caption text-muted m-0">
                    {r.reason}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
