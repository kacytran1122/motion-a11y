/**
 * A small glob matcher for ignore patterns.
 *
 * Deliberately not a dependency. The pattern language a linter's ignore file
 * needs is tiny, and pulling in a glob library would more than double the
 * install for it. What is supported:
 *
 *   node_modules      a bare name, matched against any path segment
 *   dist/             trailing slash, directories only
 *   src/generated     a path prefix, relative to the working directory
 *   *.gen.ts          `*` matches within one segment
 *   **\/__mocks__     `**` matches any number of segments
 *   src/**\/*.spec.ts  the two combined
 *
 * There is no negation (`!`), because a linter that silently un-ignores files
 * is harder to reason about than one that does not.
 */

/** Characters that must be taken literally inside the generated expression. */
const ESCAPE = /[.+^${}()|[\]\\]/g;

/**
 * Ignore patterns can arrive from a checked in `.motion-a11yignore`, which on a
 * CI run means they come from whoever opened the pull request. An unbounded
 * pattern is therefore untrusted input, and a naive translation of `***...*`
 * into `[^/]*[^/]*[^/]*...` backtracks exponentially on a near miss, which
 * hangs the whole run.
 *
 * Normalising first makes that unrepresentable: no two unbounded quantifiers
 * can ever end up next to each other.
 */
const MAX_PATTERN_LENGTH = 1024;

export function normalisePattern(pattern: string): string {
  const segments: string[] = [];
  for (const segment of pattern.split("/")) {
    // A segment of nothing but stars is the "any number of directories" form;
    // any other run of stars is just "anything within this segment".
    const collapsed = /^\*+$/.test(segment) ? "**" : segment.replace(/\*+/g, "*");
    // Consecutive `**` segments say nothing more than a single one.
    if (collapsed === "**" && segments[segments.length - 1] === "**") continue;
    segments.push(collapsed);
  }
  return segments.join("/");
}

/** Compiles one glob into an anchored regular expression. */
function compile(rawPattern: string): RegExp {
  const pattern = normalisePattern(rawPattern);
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "*") {
      if (pattern[i + 1] !== "*") {
        source += "[^/]*"; // one segment only
        continue;
      }
      i++; // consume the second star
      if (pattern[i + 1] === "/") {
        // `a/**/b` has to match `a/b` too, so the whole group is optional.
        i++;
        source += "(?:.*/)?";
      } else {
        // Trailing `a/**` means everything underneath, slashes included.
        source += ".*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += char.replace(ESCAPE, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export interface IgnoreRule {
  readonly pattern: string;
  readonly directoryOnly: boolean;
  /** True when the pattern has no slash, so it matches any single segment. */
  readonly bare: boolean;
  readonly test: RegExp;
}

export function parseIgnorePattern(raw: string): IgnoreRule | null {
  let pattern = raw.trim();
  if (pattern.length === 0 || pattern.startsWith("#")) return null;
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(
      `Ignore pattern is too long (limit ${MAX_PATTERN_LENGTH} characters): ${pattern.slice(0, 40)}...`,
    );
  }
  if (pattern.startsWith("!")) {
    // Explicitly unsupported rather than silently ignored.
    throw new Error(`Ignore negation is not supported: ${raw}`);
  }
  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) pattern = pattern.slice(0, -1);
  pattern = pattern.replace(/^\.\//, "").replace(/^\/+/, "");
  if (pattern.length === 0) return null;
  pattern = normalisePattern(pattern);
  if (pattern.length === 0) return null;
  const bare = !pattern.includes("/");
  return { pattern, directoryOnly, bare, test: compile(pattern) };
}

/** Reads an ignore file's contents into rules. */
export function parseIgnoreFile(contents: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const rule = parseIgnorePattern(line);
    if (rule) rules.push(rule);
  }
  return rules;
}

export class Ignorer {
  private readonly rules: IgnoreRule[];

  constructor(rules: IgnoreRule[]) {
    this.rules = rules;
  }

  get size(): number {
    return this.rules.length;
  }

  /**
   * `path` must be relative to the root and use forward slashes, which is what
   * keeps the same ignore file working on Windows.
   *
   * A directory pattern covers everything underneath it, the way gitignore
   * behaves: `generated/` hides the directory and every file in it.
   */
  matches(path: string, isDirectory: boolean): boolean {
    if (this.rules.length === 0) return false;
    const segments = path.split("/");

    for (const rule of this.rules) {
      if (rule.bare) {
        // A bare name matches any segment. For a directory only rule the final
        // segment counts only when the path really is a directory.
        const limit = rule.directoryOnly && !isDirectory ? segments.length - 1 : segments.length;
        for (let i = 0; i < limit; i++) {
          if (rule.test.test(segments[i]!)) return true;
        }
        continue;
      }

      if ((!rule.directoryOnly || isDirectory) && rule.test.test(path)) return true;

      // Any ancestor directory matching the pattern hides what is beneath it.
      for (let i = segments.length - 1; i > 0; i--) {
        if (rule.test.test(segments.slice(0, i).join("/"))) return true;
      }
    }
    return false;
  }
}
