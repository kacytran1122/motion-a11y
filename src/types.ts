export type Severity = "off" | "warn" | "error";

export type RuleId =
  | "require-reduced-motion-guard"
  | "no-infinite-animation"
  | "no-long-animation"
  | "no-scroll-linked-animation"
  | "no-smooth-scroll"
  | "no-fast-flash"
  | "no-autoplay-lottie";

export interface Message {
  /** Rule that produced the message. */
  rule: RuleId;
  severity: "warn" | "error";
  message: string;
  /** WCAG success criterion, when the rule maps to one. */
  wcag?: string;
  /** 1 based. */
  line: number;
  /** 1 based. */
  column: number;
  endLine: number;
  endColumn: number;
  /** The library the finding came from, when known. */
  source?: string;
}

export interface LintResult {
  filename: string;
  messages: Message[];
  errorCount: number;
  warningCount: number;
  /** True when the file contains a reduced motion guard. */
  guarded: boolean;
  /** Set when the file could not be parsed. */
  parseError?: string;
  /**
   * Set when the file parsed but analysis failed. One unusual file must never
   * take down a whole run, so the failure is reported per file instead.
   */
  analysisError?: string;
}

export type PresetName = "recommended" | "strict";

export interface LintOptions {
  filename?: string;
  preset?: PresetName;
  rules?: Partial<Record<RuleId, Severity>>;
  /**
   * Skip parsing files that contain no animation marker at all. On by default,
   * because parsing dominates the cost and most files in a repository never
   * animate. Such a file cannot produce a finding, but it also will not report
   * a syntax error. Set to false when you want every file parsed.
   */
  prefilter?: boolean;
}

/** 1 based line and column positions, as reported by the parser. */
export interface FindingSpan {
  start: number;
  end: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** Internal: a raw finding before severity is applied. */
export interface Finding {
  rule: RuleId;
  message: string;
  wcag?: string;
  /** Character offsets into the source. */
  start: number;
  end: number;
  /** Line and column data from the parser, when the node carried it. */
  span?: FindingSpan | null;
  source?: string;
  /** When true, a reduced motion guard in the file does not silence it. */
  unsuppressable?: boolean;
}
