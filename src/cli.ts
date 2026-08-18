#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { lint, presets, RULE_IDS } from "./index.js";
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
  "vendor",
]);

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
}

function parseArgs(argv: string[]): Cli | { help: true } | { listRules: true } | { version: true } {
  const cli: Cli = {
    paths: [],
    preset: "recommended",
    rules: {},
    format: "pretty",
    extensions: DEFAULT_EXTENSIONS,
    maxWarnings: Number.POSITIVE_INFINITY,
    quiet: false,
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
      case "--preset": {
        const value = argv[++i];
        if (value !== "recommended" && value !== "strict") {
          throw new Error(`Unknown preset: ${value}`);
        }
        cli.preset = value;
        break;
      }
      case "--format": {
        const value = argv[++i];
        if (value !== "pretty" && value !== "json" && value !== "github") {
          throw new Error(`Unknown format: ${value}`);
        }
        cli.format = value;
        break;
      }
      case "--ext":
        cli.extensions = (argv[++i] ?? "")
          .split(",")
          .map((e) => (e.startsWith(".") ? e : `.${e}`))
          .filter(Boolean);
        break;
      case "--max-warnings":
        cli.maxWarnings = Number(argv[++i]);
        break;
      case "--rule": {
        const value = argv[++i] ?? "";
        const [id, severity] = value.split("=") as [RuleId, Severity];
        if (!RULE_IDS.includes(id)) throw new Error(`Unknown rule: ${id}`);
        if (!["off", "warn", "error"].includes(severity)) {
          throw new Error(`Unknown severity: ${severity}`);
        }
        cli.rules[id] = severity;
        break;
      }
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        cli.paths.push(arg);
    }
  }

  if (cli.paths.length === 0) cli.paths.push(".");
  return cli;
}

function findFiles(target: string, extensions: string[], out: string[] = []): string[] {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    throw new Error(`Cannot read path: ${target}`);
  }

  if (stats.isFile()) {
    out.push(target);
    return out;
  }

  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      findFiles(join(target, entry.name), extensions, out);
    } else if (entry.isFile()) {
      if (extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(join(target, entry.name));
      }
    }
  }
  return out;
}

function main(): void {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  if ("help" in parsed) {
    console.log(HELP.trim());
    return;
  }
  if ("version" in parsed) {
    console.log(`motion-a11y ${version}`);
    return;
  }
  if ("listRules" in parsed) {
    for (const id of RULE_IDS) {
      console.log(`${id.padEnd(30)} recommended: ${presets.recommended[id]}`);
    }
    return;
  }

  const cli = parsed;
  const files: string[] = [];
  try {
    for (const path of cli.paths) findFiles(resolve(path), cli.extensions, files);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const results: LintResult[] = [];
  for (const file of files) {
    const code = readFileSync(file, "utf8");
    const result = lint(code, {
      filename: relative(process.cwd(), file),
      preset: cli.preset,
      rules: cli.rules,
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

  const errors = results.reduce((n, r) => n + r.errorCount, 0);
  const warnings = results.reduce((n, r) => n + r.warningCount, 0);
  process.exit(errors > 0 || warnings > cli.maxWarnings ? 1 : 0);
}

main();
