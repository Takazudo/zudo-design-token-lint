export { checkClass, checkClassWithConfig, setConfig, getConfig, type Violation } from './rules.js';
export {
  extractClasses,
  type ExtractedClass,
  type ExtractorOptions,
  DEFAULT_CLASS_ATTRIBUTES,
  DEFAULT_CLASS_FUNCTIONS,
} from './extractor.js';
export { lintFile, lintContent, type LintResult } from './linter.js';
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
