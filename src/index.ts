import { createLocator, parseFile, type Node } from "./ast.js";
import { collect, mightAnimate } from "./collect.js";
import { runRules } from "./rules.js";
import type {
  Finding,
  FindingSpan,
  LintOptions,
  LintResult,
  Message,
  PresetName,
  RuleId,
  Severity,
} from "./types.js";

export type {
  Finding,
  FindingSpan,
  LintOptions,
  LintResult,
  Message,
  PresetName,
  RuleId,
  Severity,
} from "./types.js";

export { mightAnimate } from "./collect.js";

export const RULE_IDS: RuleId[] = [
  "require-reduced-motion-guard",
  "no-infinite-animation",
  "no-long-animation",
  "no-scroll-linked-animation",
  "no-smooth-scroll",
  "no-fast-flash",
  "no-autoplay-lottie",
];

const RULE_ID_SET: ReadonlySet<string> = new Set<string>(RULE_IDS);
const SEVERITIES: ReadonlySet<string> = new Set(["off", "warn", "error"]);

export function isRuleId(value: unknown): value is RuleId {
  return typeof value === "string" && RULE_ID_SET.has(value);
}

export function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && SEVERITIES.has(value);
}

export const presets: Record<PresetName, Record<RuleId, Severity>> = {
  recommended: {
    "require-reduced-motion-guard": "error",
    "no-infinite-animation": "error",
    "no-long-animation": "warn",
    "no-scroll-linked-animation": "warn",
    "no-smooth-scroll": "warn",
    "no-fast-flash": "error",
    "no-autoplay-lottie": "warn",
  },
  strict: {
    "require-reduced-motion-guard": "error",
    "no-infinite-animation": "error",
    "no-long-animation": "error",
    "no-scroll-linked-animation": "error",
    "no-smooth-scroll": "error",
    "no-fast-flash": "error",
    "no-autoplay-lottie": "error",
  },
};

/**
 * The parser already knows the line and column of every node, so the usual case
 * needs no lookup at all. The locator is only consulted for a finding whose
 * node carried no position data.
 */
function positionOf(finding: Finding, locate: ReturnType<typeof createLocator>): FindingSpan {
  if (finding.span) return finding.span;
  const start = locate(finding.start);
  const end = locate(finding.end);
  return {
    start: finding.start,
    end: finding.end,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function toMessage(
  finding: Finding,
  severity: "warn" | "error",
  locate: ReturnType<typeof createLocator>,
): Message {
  const at = positionOf(finding, locate);
  return {
    rule: finding.rule,
    severity,
    message: finding.message,
    wcag: finding.wcag,
    line: at.startLine,
    column: at.startColumn,
    endLine: at.endLine,
    endColumn: at.endColumn,
    source: finding.source,
  };
}

/** Applies preset and per-rule overrides, ignoring anything that is not a real setting. */
function resolveSeverities(options: LintOptions): Record<RuleId, Severity> {
  const presetName: PresetName = options.preset === "strict" ? "strict" : "recommended";
  const severities = { ...presets[presetName] };
  const overrides = options.rules;
  if (overrides) {
    for (const key of Object.keys(overrides) as RuleId[]) {
      const value = overrides[key];
      // An explicit `undefined` must not knock the preset value out.
      if (isRuleId(key) && isSeverity(value)) severities[key] = value;
    }
  }
  return severities;
}

const EMPTY_RESULT = (filename: string): LintResult => ({
  filename,
  messages: [],
  errorCount: 0,
  warningCount: 0,
  guarded: false,
});

/**
 * Lints a single source file for animation accessibility problems.
 *
 * This checks JavaScript and TypeScript, which is where animation libraries
 * live. Plain CSS keyframes are already covered by stylelint-a11y, so run
 * both if your project animates in CSS as well.
 */
export function lint(code: string, options: LintOptions = {}): LintResult {
  const filename = options.filename ?? "input.tsx";

  if (typeof code !== "string") {
    return { ...EMPTY_RESULT(filename), parseError: "Source must be a string." };
  }

  // A file with no animation marker anywhere cannot produce a finding, and
  // parsing is the expensive part. In a real repository most files land here.
  if (options.prefilter !== false && !mightAnimate(code)) return EMPTY_RESULT(filename);

  let ast;
  try {
    ast = parseFile(code, filename);
  } catch (error) {
    return {
      ...EMPTY_RESULT(filename),
      parseError: error instanceof Error ? error.message : String(error),
    };
  }

  return lintAst(ast, code, options);
}

/**
 * Lints an already parsed Babel AST.
 *
 * Exported so a caller that has parsed the file for other reasons does not have
 * to parse it twice. `code` is only read to resolve positions for the rare node
 * that carries none, so passing the original source is enough.
 */
export function lintAst(ast: Node, code: string, options: LintOptions = {}): LintResult {
  const filename = options.filename ?? "input.tsx";
  const severities = resolveSeverities(options);

  let context;
  let findings;
  try {
    context = collect(ast);
    findings = runRules(context);
  } catch (error) {
    // A file the analyser cannot handle is one lost file, not a lost run.
    return {
      ...EMPTY_RESULT(filename),
      analysisError: error instanceof Error ? error.message : String(error),
    };
  }

  const locate = createLocator(code);
  const messages: Message[] = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const finding of findings) {
    const severity = severities[finding.rule];
    if (severity !== "warn" && severity !== "error") continue; // "off" or unknown
    messages.push(toMessage(finding, severity, locate));
    if (severity === "error") errorCount++;
    else warningCount++;
  }

  messages.sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));

  return { filename, messages, errorCount, warningCount, guarded: context.guarded };
}
