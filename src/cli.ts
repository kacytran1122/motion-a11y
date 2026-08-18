#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, sep } from "node:path";
import { isRuleId, isSeverity, lint, presets, RULE_IDS } from "./index.js";
import { formatGithub, formatJson, formatPretty } from "./format.js";
import type { LintResult, PresetName, RuleId, Severity } from "./types.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const DEFAULT_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".yarn",
  "vendor",
]);

/** Bundled and minified output is generated code; linting it only produces noise. */
const GENERATED_FILE = /\.(min|bundle|chunk)\.[cm]?jsx?$/i;

/** Above this, a file is almost certainly generated. Parsing it costs far more than it is worth. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const HELP = `
motion-a11y  Accessibility linter for animation code

Usage
  motion-a11y [paths...] [options]

Options
  --preset <name>     recommended (default) or strict
  --rule <id>=<sev>   Override one rule. sev is off, warn or error. Repeatable.
  --format <name>     pretty (default), json or github
  --ext <list>        Comma separated extensions. Default: ${DEFAULT_EXTENSIONS.join(",")}
  --max-warnings <n>  Exit 1 when warnings exceed n. Default: unlimited
  --no-prefilter      Parse every file, even ones with no animation code
  --quiet             Only report errors
  --rules             List every rule and exit
  --version           Print the version and exit
  --help              Show this help

Examples
  npx motion-a11y src
  npx motion-a11y src --preset strict --format github
  npx motion-a11y src --rule no-smooth-scroll=off

This checks JavaScript and TypeScript, where animation libraries live.
Plain CSS keyframes are covered by stylelint-a11y. Run both.
`;

interface Cli {
  paths: string[];
  preset: PresetName;
  rules: Partial<Record<RuleId, Severity>>;
  format: "pretty" | "json" | "github";
  extensions: string[];
  maxWarnings: number;
  quiet: boolean;
  prefilter: boolean;
}

class UsageError extends Error {}

/** Reads the value that follows a flag, failing clearly when it is missing. */
function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) throw new UsageError(`${flag} needs a value`);
  return value;
}

export function parseArgs(
  argv: string[],
): Cli | { help: true } | { listRules: true } | { version: true } {
  const cli: Cli = {
    paths: [],
    preset: "recommended",
    rules: {},
    format: "pretty",
    extensions: DEFAULT_EXTENSIONS,
    maxWarnings: Number.POSITIVE_INFINITY,
    quiet: false,
    prefilter: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--help":
      case "-h":
        return { help: true };
      case "--rules":
        return { listRules: true };
      case "--version":
      case "-v":
        return { version: true };
      case "--quiet":
        cli.quiet = true;
        break;
      case "--no-prefilter":
        cli.prefilter = false;
        break;
      case "--preset": {
        const value = requireValue(argv, ++i, "--preset");
        if (value !== "recommended" && value !== "strict") {
          throw new UsageError(`Unknown preset: ${value}. Use recommended or strict.`);
        }
        cli.preset = value;
        break;
      }
      case "--format": {
        const value = requireValue(argv, ++i, "--format");
        if (value !== "pretty" && value !== "json" && value !== "github") {
          throw new UsageError(`Unknown format: ${value}. Use pretty, json or github.`);
        }
        cli.format = value;
        break;
      }
      case "--ext": {
        const value = requireValue(argv, ++i, "--ext");
        const extensions = value
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e.length > 0 && e !== ".")
          .map((e) => (e.startsWith(".") ? e : `.${e}`));
        if (extensions.length === 0) throw new UsageError(`--ext needs at least one extension`);
        cli.extensions = extensions;
        break;
      }
      case "--max-warnings": {
        const value = requireValue(argv, ++i, "--max-warnings");
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new UsageError(`--max-warnings needs a number that is zero or more, got: ${value}`);
        }
        cli.maxWarnings = parsed;
        break;
      }
      case "--rule": {
        const value = requireValue(argv, ++i, "--rule");
        const split = value.indexOf("=");
        if (split === -1) throw new UsageError(`--rule needs <id>=<severity>, got: ${value}`);
        const id = value.slice(0, split);
        const severity = value.slice(split + 1);
        if (!isRuleId(id)) throw new UsageError(`Unknown rule: ${id}`);
        if (!isSeverity(severity)) {
          throw new UsageError(`Unknown severity: ${severity}. Use off, warn or error.`);
        }
        cli.rules[id] = severity;
        break;
      }
      default:
        if (arg.startsWith("-")) throw new UsageError(`Unknown option: ${arg}`);
        cli.paths.push(arg);
    }
  }

  if (cli.paths.length === 0) cli.paths.push(".");
  return cli;
}

/**
 * Collects source files under the given roots.
 *
 * Iterative rather than recursive so a deep tree cannot overflow the stack, and
 * de-duplicating so that overlapping arguments (`motion-a11y src src/App.tsx`)
 * do not lint the same file twice.
 */
export function findFiles(roots: string[], extensions: string[]): string[] {
  const found = new Set<string>();
  const seenDirs = new Set<string>();
  const queue: string[] = [];

  const matches = (name: string): boolean =>
    !GENERATED_FILE.test(name) && extensions.some((ext) => name.endsWith(ext));

  for (const root of roots) {
    let stats;
    try {
      stats = statSync(root);
    } catch {
      throw new UsageError(`Cannot read path: ${root}`);
    }
    // An explicitly named file is linted whatever it is called.
    if (stats.isFile()) found.add(root);
    else if (stats.isDirectory()) queue.push(root);
    else throw new UsageError(`Not a file or directory: ${root}`);
  }

  while (queue.length > 0) {
    const dir = queue.pop()!;
    // Resolving to the real path is what stops a symlink loop from spinning
    // forever; readdir alone will happily follow one.
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      continue;
    }
    if (seenDirs.has(real)) continue;
    seenDirs.add(real);

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory, for example a permissions error
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        queue.push(full);
      } else if (entry.isFile()) {
        if (matches(entry.name)) found.add(full);
      } else if (entry.isSymbolicLink()) {
        // Resolve the link so that symlinked source trees are still linted.
        let target;
        try {
          target = statSync(full);
        } catch {
          continue; // broken link
        }
        if (target.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) queue.push(full);
        } else if (target.isFile() && matches(entry.name)) {
          found.add(full);
        }
      }
    }
  }

  return [...found].sort();
}

function displayName(file: string): string {
  const rel = relative(process.cwd(), file);
  // A path outside the working directory reads better absolute than as ../../..
  return rel === "" || rel.startsWith(`..${sep}`) ? file : rel;
}

export function run(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  if ("help" in parsed) {
    console.log(HELP.trim());
    return 0;
  }
  if ("version" in parsed) {
    console.log(`motion-a11y ${version}`);
    return 0;
  }
  if ("listRules" in parsed) {
    for (const id of RULE_IDS) {
      console.log(`${id.padEnd(30)} recommended: ${presets.recommended[id]}`);
    }
    return 0;
  }

  const cli = parsed;
  let files: string[];
  try {
    files = findFiles(cli.paths.map((path) => resolve(path)), cli.extensions);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const results: LintResult[] = [];
  for (const file of files) {
    const filename = displayName(file);
    let code: string;
    try {
      code = readFileSync(file, "utf8");
      if (code.length > MAX_FILE_BYTES) continue; // generated bundle
    } catch (error) {
      results.push({
        filename,
        messages: [],
        errorCount: 0,
        warningCount: 0,
        guarded: false,
        parseError: `Could not read the file. ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const result = lint(code, {
      filename,
      preset: cli.preset,
      rules: cli.rules,
      prefilter: cli.prefilter,
    });
    if (cli.quiet) {
      result.messages = result.messages.filter((m) => m.severity === "error");
      result.warningCount = 0;
    }
    results.push(result);
  }

  const output =
    cli.format === "json"
      ? formatJson(results)
      : cli.format === "github"
        ? formatGithub(results)
        : formatPretty(results);
  if (output) console.log(output);

  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    errors += result.errorCount;
    warnings += result.warningCount;
  }
  return errors > 0 || warnings > cli.maxWarnings ? 1 : 0;
}

/**
 * Only run when this module is the program being executed, so that the parsing
 * and discovery functions above can be imported by tests without linting the
 * test runner's own arguments.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  // Setting exitCode rather than calling exit lets stdout flush first, which
  // matters when the output is piped.
  process.exitCode = run(process.argv.slice(2));
}
