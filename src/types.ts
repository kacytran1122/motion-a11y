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
}

export type PresetName = "recommended" | "strict";

export interface LintOptions {
  filename?: string;
  preset?: PresetName;
  rules?: Partial<Record<RuleId, Severity>>;
}

/** Internal: a raw finding before severity is applied. */
export interface Finding {
  rule: RuleId;
  message: string;
  wcag?: string;
  start: number;
  end: number;
  source?: string;
  /** When true, a reduced motion guard in the file does not silence it. */
  unsuppressable?: boolean;
}
