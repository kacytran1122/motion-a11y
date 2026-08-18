import type { LintResult, Message } from "./types.js";

export interface FormatOptions {
  /** Defaults to whether stdout is a colour capable terminal. */
  color?: boolean;
}

function colorEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return true;
  return process.stdout?.isTTY === true;
}

function painter(enabled: boolean) {
  const paint = (code: string, text: string) =>
    enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
  return {
    dim: (t: string) => paint("2", t),
    red: (t: string) => paint("31", t),
    yellow: (t: string) => paint("33", t),
    bold: (t: string) => paint("1", t),
    green: (t: string) => paint("32", t),
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function formatPretty(results: LintResult[], options: FormatOptions = {}): string {
  const { dim, red, yellow, bold, green } = painter(options.color ?? colorEnabled());
  const lines: string[] = [];
  let errors = 0;
  let warnings = 0;
  let parseErrors = 0;

  for (const result of results) {
    const failure = result.parseError ?? result.analysisError;
    if (failure) {
      parseErrors++;
      lines.push(bold(result.filename));
      lines.push(`  ${red(result.parseError ? "parse error" : "check failed")} ${failure}`);
      lines.push("");
      continue;
    }
    if (result.messages.length === 0) continue;

    lines.push(bold(result.filename));
    for (const message of result.messages) {
      const badge = message.severity === "error" ? red("error") : yellow("warn ");
      const position = dim(`${message.line}:${message.column}`.padEnd(8));
      lines.push(`  ${position} ${badge}  ${message.message}`);
      const meta = [message.rule, message.wcag ? `WCAG ${message.wcag}` : null]
        .filter(Boolean)
        .join("  ");
      lines.push(`  ${" ".repeat(8)}        ${dim(meta)}`);
      if (message.severity === "error") errors++;
      else warnings++;
    }
    lines.push("");
  }

  // A file that could not be parsed went unchecked, so reporting "no problems
  // found" would be wrong even though no rule fired.
  if (errors === 0 && warnings === 0 && parseErrors === 0) {
    return green("No animation accessibility problems found.");
  }

  const parts = [plural(errors, "error"), plural(warnings, "warning")];
  if (parseErrors > 0) parts.push(`${plural(parseErrors, "file")} could not be checked`);
  const summary = parts.join(", ");
  lines.push(errors > 0 ? red(summary) : yellow(summary));
  return lines.join("\n");
}

export function formatJson(results: LintResult[]): string {
  let errorCount = 0;
  let warningCount = 0;
  let parseErrorCount = 0;
  for (const result of results) {
    errorCount += result.errorCount;
    warningCount += result.warningCount;
    if (result.parseError ?? result.analysisError) parseErrorCount++;
  }
  return JSON.stringify({ results, errorCount, warningCount, parseErrorCount }, null, 2);
}

/**
 * GitHub Actions reads annotations line by line and splits properties on commas
 * and colons, so anything that could appear in a filename or a message has to be
 * percent encoded or the annotation is silently mangled.
 */
function encodeData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function encodeProperty(value: string): string {
  return encodeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/** GitHub Actions annotation format, so findings show up inline on a pull request. */
export function formatGithub(results: LintResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    const file = encodeProperty(result.filename);
    const failure = result.parseError ?? result.analysisError;
    if (failure) {
      lines.push(
        `::warning file=${file},title=motion-a11y could not check this file::${encodeData(
          `This file was skipped, so it is unchecked. ${failure}`,
        )}`,
      );
      continue;
    }
    for (const message of result.messages) {
      lines.push(annotate(file, message));
    }
  }
  return lines.join("\n");
}

function annotate(file: string, message: Message): string {
  const level = message.severity === "error" ? "error" : "warning";
  const title = message.wcag ? `${message.rule} (WCAG ${message.wcag})` : message.rule;
  const position = [
    `line=${message.line}`,
    `col=${message.column}`,
    // endLine and endColumn make the annotation cover the call rather than a point.
    `endLine=${message.endLine}`,
    message.endLine === message.line ? `endColumn=${message.endColumn}` : null,
  ]
    .filter(Boolean)
    .join(",");
  return `::${level} file=${file},${position},title=${encodeProperty(title)}::${encodeData(message.message)}`;
}
