export { checkClass, checkClassWithConfig, setConfig, getConfig, type Violation } from './rules.js';
export { extractClasses, type ExtractedClass } from './extractor.js';
export { lintFile, lintContent, type LintResult } from './linter.js';
export {
  loadConfig,
  compileConfig,
  compilePattern,
  DEFAULT_CONFIG,
  type LintConfig,
  type CompiledConfig,
  type CompiledRule,
} from './config.js';
