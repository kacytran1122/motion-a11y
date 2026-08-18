import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRuleId, isSeverity } from "./index.js";
import type { PresetName, RuleId, Severity } from "./types.js";

/**
 * Project configuration.
 *
 * JSON only, on purpose. A config file that can execute code is a supply chain
 * surface for a tool people run in CI over a checkout, and nothing here needs
 * to be computed.
 */
export interface Config {
  preset?: PresetName;
  rules?: Partial<Record<RuleId, Severity>>;
  ignore?: string[];
  extensions?: string[];
  maxWarnings?: number;
  quiet?: boolean;
}

/** Searched in order; the first one that exists wins. */
export const CONFIG_FILES = [
  "motion-a11y.config.json",
  ".motion-a11yrc.json",
  ".motion-a11yrc",
] as const;

export const IGNORE_FILE = ".motion-a11yignore";

export class ConfigError extends Error {}

function fail(source: string, detail: string): never {
  throw new ConfigError(`${source}: ${detail}`);
}

/** Validates parsed JSON into a Config, naming the offending key on failure. */
export function validateConfig(raw: unknown, source: string): Config {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(source, "expected a JSON object");
  }
  const input = raw as Record<string, unknown>;
  const config: Config = {};

  const known = new Set(["preset", "rules", "ignore", "extensions", "maxWarnings", "quiet"]);
  for (const key of Object.keys(input)) {
    // A typo in a config file is otherwise invisible, which is worse than an error.
    if (!known.has(key))
      fail(source, `unknown option "${key}". Known options: ${[...known].join(", ")}`);
  }

  if (input.preset !== undefined) {
    if (input.preset !== "recommended" && input.preset !== "strict") {
      fail(source, `preset must be "recommended" or "strict"`);
    }
    config.preset = input.preset;
  }

  if (input.rules !== undefined) {
    if (input.rules === null || typeof input.rules !== "object" || Array.isArray(input.rules)) {
      fail(source, "rules must be an object");
    }
    const rules: Partial<Record<RuleId, Severity>> = {};
    for (const [id, severity] of Object.entries(input.rules as Record<string, unknown>)) {
      if (!isRuleId(id)) fail(source, `unknown rule "${id}"`);
      if (!isSeverity(severity)) fail(source, `rule "${id}" must be off, warn or error`);
      rules[id] = severity;
    }
    config.rules = rules;
  }

  for (const key of ["ignore", "extensions"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      fail(source, `${key} must be an array of strings`);
    }
    config[key] = value as string[];
  }

  if (input.maxWarnings !== undefined) {
    if (
      typeof input.maxWarnings !== "number" ||
      !Number.isFinite(input.maxWarnings) ||
      input.maxWarnings < 0
    ) {
      fail(source, "maxWarnings must be a number that is zero or more");
    }
    config.maxWarnings = input.maxWarnings;
  }

  if (input.quiet !== undefined) {
    if (typeof input.quiet !== "boolean") fail(source, "quiet must be true or false");
    config.quiet = input.quiet;
  }

  return config;
}

export interface LoadedConfig {
  config: Config;
  /** Where it came from, for error messages. Null when no file was found. */
  source: string | null;
}

/**
 * Loads config from an explicit path, or by looking for a known file name in
 * `directory`. Falls back to the `motion-a11y` key in package.json.
 */
export function loadConfig(directory: string, explicitPath?: string): LoadedConfig {
  if (explicitPath) {
    let text;
    try {
      text = readFileSync(explicitPath, "utf8");
    } catch {
      throw new ConfigError(`Cannot read config file: ${explicitPath}`);
    }
    return {
      config: validateConfig(parseJson(text, explicitPath), explicitPath),
      source: explicitPath,
    };
  }

  for (const name of CONFIG_FILES) {
    const path = join(directory, name);
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    return { config: validateConfig(parseJson(text, path), path), source: path };
  }

  const packagePath = join(directory, "package.json");
  try {
    const parsed = parseJson(readFileSync(packagePath, "utf8"), packagePath) as Record<
      string,
      unknown
    >;
    const section = parsed?.["motion-a11y"];
    if (section !== undefined) {
      return {
        config: validateConfig(section, `${packagePath} ("motion-a11y")`),
        source: `${packagePath} ("motion-a11y")`,
      };
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error;
  }

  return { config: {}, source: null };
}

function parseJson(text: string, source: string): unknown {
  try {
    // Strip a byte order mark, which editors on Windows add routinely.
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new ConfigError(
      `${source}: invalid JSON. ${error instanceof Error ? error.message : ""}`,
    );
  }
}

/** Reads `.motion-a11yignore` from `directory`, if it is there. */
export function readIgnoreFile(directory: string): string | null {
  try {
    return readFileSync(join(directory, IGNORE_FILE), "utf8");
  } catch {
    return null;
  }
}
