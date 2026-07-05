export { checkClass, checkClassWithConfig, setConfig, getConfig, type Violation } from './rules.js';
export {
  extractClasses,
  type ExtractedClass,
  type ExtractorOptions,
  DEFAULT_CLASS_ATTRIBUTES,
  DEFAULT_CLASS_FUNCTIONS,
} from './extractor.js';
export { lintFile, lintContent, type LintResult } from './linter.js';
// Additive — issue #129: extractor ignore-comment metadata (internal groundwork
// for wave-5 ignore-hygiene reporting; does not change extractClasses()).
export {
  extractClassesWithMeta,
  type IgnoreKind,
  type IgnoreRecord,
  type ExtractWithMetaResult,
} from './extractor.js';
export {
  loadConfig,
  compileConfig,
  compilePattern,
  DEFAULT_CONFIG,
  CONFIG_PRESETS,
  DEFAULT_PRESET_NAME,
  type LintConfig,
  type CompiledConfig,
  type CompiledRule,
  type ConfigPreset,
} from './config.js';

// --- issue #128: structured prohibited entries (reason/category) ---
export {
  type ProhibitedEntry,
  type ProhibitedConfigEntry,
  type CompilePatternOptions,
} from './config.js';
// --- end issue #128 additions ---
