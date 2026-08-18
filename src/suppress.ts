import type { Node } from "./ast.js";
import type { RuleId } from "./types.js";

/**
 * Inline suppression comments.
 *
 * A linter without an escape hatch gets switched off wholesale the first time
 * it is wrong, which costs far more coverage than the occasional false
 * positive it was protecting against. These are the same shapes ESLint uses,
 * so nobody has to learn anything:
 *
 *   // motion-a11y-disable-next-line
 *   // motion-a11y-disable-next-line no-infinite-animation, no-long-animation
 *   gsap.to(".a", { repeat: -1 });          // motion-a11y-disable-line
 *
 *   /* motion-a11y-disable *\/                 ... whole file from here down
 *   /* motion-a11y-enable *\/                  ... switched back on
 *
 * A bare directive covers every rule; a list covers only the rules named.
 */

const PREFIX = "motion-a11y-";

export type Directive = "disable-line" | "disable-next-line" | "disable" | "enable";

export interface Suppression {
  directive: Directive;
  /** Empty means every rule. */
  rules: RuleId[];
  /** 1 based line the comment sits on. */
  line: number;
}

/** Rules named after the directive, comma or space separated. */
function parseRules(rest: string): RuleId[] {
  return rest
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0) as RuleId[];
}

const DIRECTIVES: Directive[] = ["disable-next-line", "disable-line", "disable", "enable"];

/** Reads one comment. Returns null when it is not a directive for this tool. */
export function parseComment(value: string, line: number): Suppression | null {
  const text = value.trim();
  if (!text.startsWith(PREFIX)) return null;
  const body = text.slice(PREFIX.length);
  // Longest first so "disable-next-line" is not read as "disable".
  for (const directive of DIRECTIVES) {
    if (
      body !== directive &&
      !body.startsWith(`${directive} `) &&
      !body.startsWith(`${directive}\t`)
    ) {
      continue;
    }
    return { directive, rules: parseRules(body.slice(directive.length)), line };
  }
  return null;
}

/**
 * Decides whether a finding at a given line is suppressed.
 *
 * Built once per file from the comment list the parser already produced, so
 * this costs nothing on files that contain no directives at all.
 */
export class SuppressionMap {
  /** line -> rules disabled on that line ("*" for all) */
  private readonly perLine = new Map<number, Set<string>>();
  /** Ranges opened by a block `disable`, as [fromLine, toLine] with rule sets. */
  private readonly ranges: Array<{ from: number; to: number; rules: Set<string> }> = [];
  /** Every directive seen, so unused ones can be reported. */
  readonly directives: Suppression[] = [];
  /** True when the file contained no directives, which is the common case. */
  readonly empty: boolean;

  constructor(comments: Node[], lineCount: number) {
    const open = new Map<string, number>(); // rule (or "*") -> line it was disabled from

    for (const comment of comments ?? []) {
      const line = comment?.loc?.start?.line;
      if (typeof line !== "number") continue;
      const parsed = parseComment(String(comment.value ?? ""), line);
      if (!parsed) continue;
      this.directives.push(parsed);

      const keys = parsed.rules.length > 0 ? parsed.rules : ["*"];
      switch (parsed.directive) {
        case "disable-line":
          this.add(line, keys);
          break;
        case "disable-next-line":
          this.add(line + 1, keys);
          break;
        case "disable":
          for (const key of keys) if (!open.has(key)) open.set(key, line);
          break;
        case "enable":
          for (const key of parsed.rules.length > 0 ? parsed.rules : [...open.keys()]) {
            const from = open.get(key);
            if (from === undefined) continue;
            open.delete(key);
            this.ranges.push({ from, to: line, rules: new Set([key]) });
          }
          break;
      }
    }

    // Anything still open runs to the end of the file.
    for (const [key, from] of open) {
      this.ranges.push({ from, to: lineCount + 1, rules: new Set([key]) });
    }

    this.empty = this.directives.length === 0;
  }

  private add(line: number, keys: string[]): void {
    let set = this.perLine.get(line);
    if (!set) {
      set = new Set();
      this.perLine.set(line, set);
    }
    for (const key of keys) set.add(key);
  }

  isSuppressed(rule: RuleId, line: number): boolean {
    if (this.empty) return false;
    const onLine = this.perLine.get(line);
    if (onLine && (onLine.has("*") || onLine.has(rule))) return true;
    for (const range of this.ranges) {
      if (line < range.from || line > range.to) continue;
      if (range.rules.has("*") || range.rules.has(rule)) return true;
    }
    return false;
  }
}
