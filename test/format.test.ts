import { describe, expect, it } from "vitest";
import { formatGithub, formatJson, formatPretty } from "../src/format.js";
import type { LintResult, Message } from "../src/types.js";

const message = (over: Partial<Message> = {}): Message => ({
  rule: "no-smooth-scroll",
  severity: "warn",
  message: "Something moves.",
  wcag: "2.3.3 Animation from Interactions",
  line: 3,
  column: 5,
  endLine: 3,
  endColumn: 20,
  source: "dom",
  ...over,
});

const result = (over: Partial<LintResult> = {}): LintResult => ({
  filename: "src/App.tsx",
  messages: [],
  errorCount: 0,
  warningCount: 0,
  guarded: false,
  ...over,
});

describe("formatPretty", () => {
  it("does not claim a clean run when a file failed to parse", () => {
    const output = formatPretty([result({ parseError: "Unexpected token (2:5)" })], { color: false });
    expect(output).not.toContain("No animation accessibility problems found.");
    expect(output).toContain("parse error");
    expect(output).toContain("1 file could not be checked");
  });

  it("does not claim a clean run when analysis failed", () => {
    const output = formatPretty([result({ analysisError: "boom" })], { color: false });
    expect(output).toContain("check failed");
    expect(output).not.toContain("No animation accessibility problems found.");
  });

  it("reports a clean run when there is genuinely nothing to say", () => {
    expect(formatPretty([result()], { color: false })).toBe(
      "No animation accessibility problems found.",
    );
  });

  it("pluralises the summary", () => {
    const output = formatPretty(
      [result({ messages: [message(), message({ severity: "error" })], errorCount: 1, warningCount: 1 })],
      { color: false },
    );
    expect(output).toContain("1 error, 1 warning");
  });

  it("emits no colour codes when colour is off", () => {
    const output = formatPretty([result({ messages: [message()] })], { color: false });
    expect(output).not.toMatch(/\[/);
  });

  it("emits colour codes when colour is on", () => {
    const output = formatPretty([result({ messages: [message()] })], { color: true });
    expect(output).toMatch(/\[/);
  });
});

describe("formatGithub", () => {
  it("escapes characters that would break the annotation", () => {
    const output = formatGithub([
      result({ messages: [message({ message: "line one\nline two, with 100% commas" })] }),
    ]);
    expect(output).toContain("%0A");
    expect(output).toContain("%25");
    expect(output).not.toMatch(/::warning[^:]*\n[^:]/);
  });

  it("escapes commas and colons in property values", () => {
    const output = formatGithub([result({ filename: "src/a,b:c.tsx", messages: [message()] })]);
    expect(output).toContain("file=src/a%2Cb%3Ac.tsx");
  });

  it("includes the end position so the annotation spans the call", () => {
    const output = formatGithub([result({ messages: [message()] })]);
    expect(output).toContain("line=3,col=5,endLine=3,endColumn=20");
  });

  it("annotates a file that could not be parsed", () => {
    const output = formatGithub([result({ parseError: "Unexpected token (2:5)" })]);
    expect(output).toContain("::warning");
    expect(output).toContain("could not check this file");
    // Colons only need escaping in property values, not in the message body.
    expect(output).toContain("Unexpected token (2:5)");
  });

  it("annotates a file whose analysis failed", () => {
    const output = formatGithub([result({ analysisError: "boom" })]);
    expect(output).toContain("::warning");
    expect(output).toContain("boom");
  });

  it("produces exactly one line per finding", () => {
    const output = formatGithub([result({ messages: [message(), message()] })]);
    expect(output.split("\n")).toHaveLength(2);
  });
});

describe("formatJson", () => {
  it("is valid JSON with the totals rolled up", () => {
    const output = formatJson([
      result({ messages: [message()], warningCount: 1 }),
      result({ filename: "b.tsx", parseError: "boom" }),
    ]);
    const parsed = JSON.parse(output);
    expect(parsed.warningCount).toBe(1);
    expect(parsed.errorCount).toBe(0);
    expect(parsed.parseErrorCount).toBe(1);
    expect(parsed.results).toHaveLength(2);
  });
});
