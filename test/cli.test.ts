import { describe, it, before, after } from "node:test";
import { expect } from "./expect.js";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFiles, parseArgs } from "../src/cli.js";

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), "motion-a11y-cli-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "src", "nested"), { recursive: true });
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(root, ".hidden"), { recursive: true });

  writeFileSync(join(root, "src", "App.tsx"), `export const A = () => null;\n`);
  writeFileSync(join(root, "src", "util.ts"), `export const x = 1;\n`);
  writeFileSync(join(root, "src", "notes.md"), `# notes\n`);
  writeFileSync(join(root, "src", "vendor.min.js"), `var a=1;\n`);
  writeFileSync(join(root, "src", "nested", "Deep.jsx"), `export const D = () => null;\n`);
  writeFileSync(join(root, "node_modules", "pkg", "index.js"), `module.exports = 1;\n`);
  writeFileSync(join(root, ".hidden", "secret.ts"), `export const s = 1;\n`);
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("defaults to linting the working directory", () => {
    const cli = parseArgs([]) as { paths: string[] };
    expect(cli.paths).toEqual(["."]);
  });

  it("rejects a --max-warnings that is not a number", () => {
    expect(() => parseArgs(["--max-warnings", "lots"])).toThrow(/number/);
  });

  it("rejects a negative --max-warnings", () => {
    expect(() => parseArgs(["--max-warnings", "-1"])).toThrow(/zero or more/);
  });

  it("accepts a numeric --max-warnings", () => {
    const cli = parseArgs(["--max-warnings", "0"]) as { maxWarnings: number };
    expect(cli.maxWarnings).toBe(0);
  });

  it("rejects a --ext with no usable value", () => {
    expect(() => parseArgs(["--ext"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--ext", ","])).toThrow(/at least one/);
  });

  it("normalises extensions with and without a leading dot", () => {
    const cli = parseArgs(["--ext", "ts,.tsx, js "]) as { extensions: string[] };
    expect(cli.extensions).toEqual([".ts", ".tsx", ".js"]);
  });

  it("rejects an unknown rule or severity", () => {
    expect(() => parseArgs(["--rule", "no-such-rule=error"])).toThrow(/Unknown rule/);
    expect(() => parseArgs(["--rule", "no-smooth-scroll=loud"])).toThrow(/Unknown severity/);
    expect(() => parseArgs(["--rule", "no-smooth-scroll"])).toThrow(/<id>=<severity>/);
  });

  it("accepts a valid rule override", () => {
    const cli = parseArgs(["--rule", "no-smooth-scroll=off"]) as { rules: Record<string, string> };
    expect(cli.rules["no-smooth-scroll"]).toBe("off");
  });

  it("rejects an unknown preset, format and option", () => {
    expect(() => parseArgs(["--preset", "wild"])).toThrow(/Unknown preset/);
    expect(() => parseArgs(["--format", "xml"])).toThrow(/Unknown format/);
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown option/);
  });

  it("reads --no-prefilter", () => {
    const cli = parseArgs(["--no-prefilter"]) as { prefilter: boolean };
    expect(cli.prefilter).toBe(false);
  });

  it("returns the meta modes", () => {
    expect(parseArgs(["--help"])).toEqual({ help: true });
    expect(parseArgs(["--version"])).toEqual({ version: true });
    expect(parseArgs(["--rules"])).toEqual({ listRules: true });
  });
});

describe("findFiles", () => {
  const exts = [".js", ".jsx", ".ts", ".tsx"];

  it("walks a directory tree and matches by extension", () => {
    const files = findFiles([join(root, "src")], exts);
    expect(files.some((f) => f.endsWith("App.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("Deep.jsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("notes.md"))).toBe(false);
  });

  it("skips node_modules and hidden directories", () => {
    const files = findFiles([root], exts);
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
    expect(files.some((f) => f.includes(".hidden"))).toBe(false);
  });

  it("skips minified bundles", () => {
    const files = findFiles([join(root, "src")], exts);
    expect(files.some((f) => f.endsWith("vendor.min.js"))).toBe(false);
  });

  it("lints an explicitly named file whatever it is called", () => {
    const files = findFiles([join(root, "src", "notes.md")], exts);
    expect(files).toEqual([join(root, "src", "notes.md")]);
  });

  it("does not lint the same file twice for overlapping arguments", () => {
    const files = findFiles([join(root, "src"), join(root, "src", "App.tsx")], exts);
    expect(files.filter((f) => f.endsWith("App.tsx"))).toHaveLength(1);
  });

  it("returns a stable, sorted order", () => {
    const once = findFiles([join(root, "src")], exts);
    const twice = findFiles([join(root, "src")], exts);
    expect(once).toEqual(twice);
    expect([...once].sort()).toEqual(once);
  });

  it("fails clearly on a path that does not exist", () => {
    expect(() => findFiles([join(root, "nope")], exts)).toThrow(/Cannot read path/);
  });

  it("terminates on a symlink loop", () => {
    const loopRoot = join(root, "loop");
    mkdirSync(loopRoot, { recursive: true });
    writeFileSync(join(loopRoot, "a.ts"), `export const a = 1;\n`);
    try {
      symlinkSync(loopRoot, join(loopRoot, "self"), "dir");
    } catch {
      return; // symlinks unavailable on this platform
    }
    const files = findFiles([loopRoot], exts);
    expect(files.some((f) => f.endsWith("a.ts"))).toBe(true);
    expect(files.length).toBeLessThan(10);
  });
});
