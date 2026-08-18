import { parseFile } from "./ast.js";
import { collect } from "./collect.js";
import { runRules } from "./rules.js";
import type {
  Finding,
  LintOptions,
  LintResult,
  Message,
  PresetName,
  RuleId,
  Severity,
} from "./types.js";

export type {
  Finding,
  LintOptions,
  LintResult,
  Message,
  PresetName,
  RuleId,
  Severity,
} from "./types.js";

export const RULE_IDS: RuleId[] = [
  "require-reduced-motion-guard",
  "no-infinite-animation",
  "no-long-animation",
  "no-scroll-linked-animation",
  "no-smooth-scroll",
  "no-fast-flash",
  "no-autoplay-lottie",
];

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

/** Maps byte offsets to 1 based line and column numbers. */
function makeLocator(code: string) {
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  return (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - lineStarts[low]! + 1 };
  };
}

function toMessage(f: Finding, severity: "warn" | "error", locate: ReturnType<typeof makeLocator>): Message {
  const start = locate(f.start);
  const end = locate(f.end);
  return {
    rule: f.rule,
    severity,
    message: f.message,
    wcag: f.wcag,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    source: f.source,
  };
}

/**
 * Lints a single source file for animation accessibility problems.
 *
 * This checks JavaScript and TypeScript, which is where animation libraries
 * live. Plain CSS keyframes are already covered by stylelint-a11y, so run
 * both if your project animates in CSS as well.
 */
export function lint(code: string, options: LintOptions = {}): LintResult {
  const filename = options.filename ?? "input.tsx";
  const severities: Record<RuleId, Severity> = {
    ...presets[options.preset ?? "recommended"],
    ...(options.rules ?? {}),
  };

  let ast;
  try {
    ast = parseFile(code, filename);
  } catch (error) {
    return {
      filename,
      messages: [],
      errorCount: 0,
      warningCount: 0,
      guarded: false,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }

  const context = collect(ast);
  const findings = runRules(context);
  const locate = makeLocator(code);

  const messages: Message[] = [];
  for (const f of findings) {
    const severity = severities[f.rule];
    if (severity === "off") continue;
    // A guarded file still reports flash risk, which is why the rule marks itself.
    messages.push(toMessage(f, severity === "warn" ? "warn" : "error", locate));
  }

  messages.sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));

  return {
    filename,
    messages,
    errorCount: messages.filter((m) => m.severity === "error").length,
    warningCount: messages.filter((m) => m.severity === "warn").length,
    guarded: context.guarded,
  };
}
