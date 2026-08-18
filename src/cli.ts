#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, sep } from "node:path";
import { loadConfig, readIgnoreFile, type Config } from "./config.js";
import { Ignorer, parseIgnoreFile, parseIgnorePattern, type IgnoreRule } from "./ignore.js";
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
  --ignore <glob>     Skip paths matching a glob. Repeatable.
  --config <path>     Read settings from this JSON file
  --no-config         Ignore any config file on disk
  --no-prefilter      Parse every file, even ones with no animation code
  --allow-unchecked   Exit 0 even when a file could not be parsed
  --quiet             Only report errors
  --rules             List every rule and exit
  --version           Print the version and exit
  --help              Show this help

Examples
  npx motion-a11y src
  npx motion-a11y src --preset strict --format github
  npx motion-a11y src --rule no-smooth-scroll=off
  npx motion-a11y src --ignore "src/generated/**"

Settings can also live in motion-a11y.config.json, .motion-a11yrc.json, or a
"motion-a11y" key in package.json. Paths in .motion-a11yignore are skipped.
Command line options win over the config file.

Suppress a finding in place:
  // motion-a11y-disable-next-line no-infinite-animation
  // motion-a11y-disable-line
  /* motion-a11y-disable */ ... /* motion-a11y-enable */

This checks JavaScript and TypeScript, where animation libraries live.
Plain CSS keyframes are covered by stylelint-a11y. Run both.
`;

interface Cli {
  paths: string[];
  preset?: PresetName;
  rules: Partial<Record<RuleId, Severity>>;
  format: "pretty" | "json" | "github";
  extensions?: string[];
  maxWarnings?: number;
  ignore: string[];
  configPath?: string;
  useConfig: boolean;
  quiet?: boolean;
  prefilter: boolean;
  allowUnchecked: boolean;
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
    rules: {},
    format: "pretty",
    ignore: [],
    useConfig: true,
    prefilter: true,
    allowUnchecked: false,
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
      case "--allow-unchecked":
        cli.allowUnchecked = true;
        break;
      case "--no-config":
        cli.useConfig = false;
        break;
      case "--config":
        cli.configPath = requireValue(argv, ++i, "--config");
        break;
      case "--ignore": {
        const value = requireValue(argv, ++i, "--ignore");
        try {
          if (!parseIgnorePattern(value))
            throw new UsageError(`--ignore needs a pattern, got: ${value}`);
        } catch (error) {
          throw new UsageError(error instanceof Error ? error.message : String(error));
        }
        cli.ignore.push(value);
        break;
      }
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
export function findFiles(
  roots: string[],
  extensions: string[],
  ignorer: Ignorer = new Ignorer([]),
  base: string = process.cwd(),
): string[] {
  const found = new Set<string>();
  const seenDirs = new Set<string>();
  const queue: string[] = [];

  const matches = (name: string): boolean =>
    !GENERATED_FILE.test(name) && extensions.some((ext) => name.endsWith(ext));

  // Ignore patterns are written against the project, so they are matched on
  // the path relative to it, with forward slashes on every platform.
  const ignored = (full: string, isDirectory: boolean): boolean => {
    if (ignorer.size === 0) return false;
    const rel = relative(base, full);
    if (rel === "" || rel.startsWith(`..${sep}`)) return false;
    return ignorer.matches(rel.split(sep).join("/"), isDirectory);
  };

  for (const root of roots) {
    let stats;
    try {
      stats = statSync(root);
    } catch {
      throw new UsageError(`Cannot read path: ${root}`);
    }
    // An ignore rule applies even to a path named on the command line, so that
    // `motion-a11y .` and `motion-a11y generated` agree with each other.
    if (stats.isFile()) {
      if (!ignored(root, false)) found.add(root);
    } else if (stats.isDirectory()) {
      if (!ignored(root, true)) queue.push(root);
    } else {
      throw new UsageError(`Not a file or directory: ${root}`);
    }
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
        if (ignored(full, true)) continue;
        queue.push(full);
      } else if (entry.isFile()) {
        if (matches(entry.name) && !ignored(full, false)) found.add(full);
      } else if (entry.isSymbolicLink()) {
        // Resolve the link so that symlinked source trees are still linted.
        let target;
        try {
          target = statSync(full);
        } catch {
          continue; // broken link
        }
        if (target.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".") && !ignored(full, true)) {
            queue.push(full);
          }
        } else if (target.isFile() && matches(entry.name) && !ignored(full, false)) {
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
  const cwd = process.cwd();

  let config: Config = {};
  try {
    if (cli.useConfig || cli.configPath) {
      config = loadConfig(cwd, cli.configPath).config;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  // Command line beats config file, which beats the built in default.
  const preset = cli.preset ?? config.preset ?? "recommended";
  const rules = { ...config.rules, ...cli.rules };
  const extensions = cli.extensions ?? config.extensions ?? DEFAULT_EXTENSIONS;
  const maxWarnings = cli.maxWarnings ?? config.maxWarnings ?? Number.POSITIVE_INFINITY;
  const quiet = cli.quiet ?? config.quiet ?? false;

  let ignorer: Ignorer;
  try {
    const ignoreRules: IgnoreRule[] = [];
    const ignoreFile = cli.useConfig ? readIgnoreFile(cwd) : null;
    if (ignoreFile) ignoreRules.push(...parseIgnoreFile(ignoreFile));
    for (const pattern of [...(config.ignore ?? []), ...cli.ignore]) {
      const rule = parseIgnorePattern(pattern);
      if (rule) ignoreRules.push(rule);
    }
    ignorer = new Ignorer(ignoreRules);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  let files: string[];
  try {
    files = findFiles(
      cli.paths.map((path) => resolve(path)),
      extensions,
      ignorer,
      cwd,
    );
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
        suppressedCount: 0,
        guarded: false,
        parseError: `Could not read the file. ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const result = lint(code, {
      filename,
      preset,
      rules,
      prefilter: cli.prefilter,
    });
    if (quiet) {
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
  let unchecked = 0;
  for (const result of results) {
    errors += result.errorCount;
    warnings += result.warningCount;
    if (result.parseError ?? result.analysisError) unchecked++;
  }

  // A file the linter could not read is not a file that passed. Reporting
  // success here is how an unchecked file slips through a CI gate, so it fails
  // by default, the same way ESLint treats a parse error.
  if (unchecked > 0 && !cli.allowUnchecked) {
    console.error(
      `${unchecked} file${unchecked === 1 ? "" : "s"} could not be checked. ` +
        `Fix them, ignore them, or pass --allow-unchecked.`,
    );
    return 1;
  }

  return errors > 0 || warnings > maxWarnings ? 1 : 0;
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
