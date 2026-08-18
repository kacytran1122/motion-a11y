import type { LintResult } from "./types.js";

const supportsColor = process.env.NO_COLOR === undefined && process.stdout.isTTY === true;
const paint = (code: string, text: string) => (supportsColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const dim = (t: string) => paint("2", t);
const red = (t: string) => paint("31", t);
const yellow = (t: string) => paint("33", t);
const bold = (t: string) => paint("1", t);
const green = (t: string) => paint("32", t);

export function formatPretty(results: LintResult[]): string {
  const lines: string[] = [];
  let errors = 0;
  let warnings = 0;

  for (const result of results) {
    if (result.parseError) {
      lines.push(bold(result.filename));
      lines.push(`  ${red("parse error")} ${result.parseError}`);
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

  if (errors === 0 && warnings === 0) {
    return green("No animation accessibility problems found.");
  }
  const summary = `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`;
  lines.push(errors > 0 ? red(summary) : yellow(summary));
  return lines.join("\n");
}

export function formatJson(results: LintResult[]): string {
  return JSON.stringify(
    {
      results,
      errorCount: results.reduce((n, r) => n + r.errorCount, 0),
      warningCount: results.reduce((n, r) => n + r.warningCount, 0),
    },
    null,
    2,
  );
}

/** GitHub Actions annotation format, so findings show up inline on a pull request. */
export function formatGithub(results: LintResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    for (const message of result.messages) {
      const level = message.severity === "error" ? "error" : "warning";
      const title = message.wcag ? `${message.rule} (WCAG ${message.wcag})` : message.rule;
      lines.push(
        `::${level} file=${result.filename},line=${message.line},col=${message.column},title=${title}::${message.message}`,
      );
    }
  }
  return lines.join("\n");
}
