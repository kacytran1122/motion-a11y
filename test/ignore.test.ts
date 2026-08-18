import { describe, it } from "node:test";
import { expect } from "./expect.js";
import { Ignorer, normalisePattern, parseIgnoreFile, parseIgnorePattern } from "../src/ignore.js";

const ignorer = (...patterns: string[]) =>
  new Ignorer(patterns.map((p) => parseIgnorePattern(p)!).filter(Boolean));

describe("parseIgnorePattern", () => {
  it("skips blank lines and comments", () => {
    expect(parseIgnorePattern("")).toBeNull();
    expect(parseIgnorePattern("   ")).toBeNull();
    expect(parseIgnorePattern("# a comment")).toBeNull();
    expect(parseIgnorePattern("/")).toBeNull();
  });

  it("rejects negation loudly rather than silently dropping it", () => {
    expect(() => parseIgnorePattern("!keep.ts")).toThrow(/negation is not supported/);
  });

  it("normalises leading ./ and /", () => {
    expect(parseIgnorePattern("./src/a.ts")?.pattern).toBe("src/a.ts");
    expect(parseIgnorePattern("/src/a.ts")?.pattern).toBe("src/a.ts");
  });

  it("records a trailing slash as directory only", () => {
    expect(parseIgnorePattern("dist/")?.directoryOnly).toBe(true);
    expect(parseIgnorePattern("dist")?.directoryOnly).toBe(false);
  });
});

describe("parseIgnoreFile", () => {
  it("reads one pattern per line and tolerates CRLF", () => {
    const rules = parseIgnoreFile("# comment\r\ndist/\r\n\r\nsrc/*.gen.ts\r\n");
    expect(rules).toHaveLength(2);
    expect(rules[0]!.pattern).toBe("dist");
    expect(rules[1]!.pattern).toBe("src/*.gen.ts");
  });
});

describe("Ignorer", () => {
  it("matches nothing when empty", () => {
    expect(new Ignorer([]).matches("anything.ts", false)).toBe(false);
  });

  it("matches a bare name against any segment, like gitignore", () => {
    const ig = ignorer("node_modules");
    expect(ig.matches("node_modules/a.ts", false)).toBe(true);
    expect(ig.matches("a/b/node_modules/c.ts", false)).toBe(true);
    expect(ig.matches("src/a.ts", false)).toBe(false);
  });

  it("matches everything under a trailing double star", () => {
    const ig = ignorer("src/generated/**");
    expect(ig.matches("src/generated/a.ts", false)).toBe(true);
    expect(ig.matches("src/generated/deep/nested/a.ts", false)).toBe(true);
    expect(ig.matches("src/other/a.ts", false)).toBe(false);
  });

  it("treats a path prefix as covering everything beneath it", () => {
    const ig = ignorer("src/generated");
    expect(ig.matches("src/generated/a.ts", false)).toBe(true);
    expect(ig.matches("src/generated", true)).toBe(true);
    expect(ig.matches("src/generated2/a.ts", false)).toBe(false);
  });

  it("honours directory only patterns", () => {
    const ig = ignorer("build/");
    expect(ig.matches("build", true)).toBe(true);
    // A *file* called "build" is not a directory, so it is not covered.
    expect(ig.matches("build", false)).toBe(false);
  });

  it("a directory pattern covers everything inside it, like gitignore", () => {
    const bare = ignorer("generated/");
    expect(bare.matches("generated/a.ts", false)).toBe(true);
    expect(bare.matches("src/generated/deep/a.ts", false)).toBe(true);
    expect(bare.matches("src/other/a.ts", false)).toBe(false);

    const rooted = ignorer("src/generated/");
    expect(rooted.matches("src/generated", true)).toBe(true);
    expect(rooted.matches("src/generated/a.ts", false)).toBe(true);
    expect(rooted.matches("src/generated/deep/a.ts", false)).toBe(true);
    expect(rooted.matches("lib/generated/a.ts", false)).toBe(false);
  });

  it("an ancestor match does not depend on the trailing slash", () => {
    const ig = ignorer("src/vendor");
    expect(ig.matches("src/vendor/deep/a.ts", false)).toBe(true);
    expect(ig.matches("src/vendored/a.ts", false)).toBe(false);
  });

  it("keeps a single star inside one segment", () => {
    const ig = ignorer("src/*.gen.ts");
    expect(ig.matches("src/a.gen.ts", false)).toBe(true);
    expect(ig.matches("src/deep/a.gen.ts", false)).toBe(false);
  });

  it("lets a leading double star match at any depth, including zero", () => {
    const ig = ignorer("**/__mocks__");
    expect(ig.matches("__mocks__", true)).toBe(true);
    expect(ig.matches("src/a/__mocks__", true)).toBe(true);
  });

  it("combines both stars", () => {
    const ig = ignorer("src/**/*.spec.ts");
    expect(ig.matches("src/a.spec.ts", false)).toBe(true);
    expect(ig.matches("src/a/b/c.spec.ts", false)).toBe(true);
    expect(ig.matches("lib/a.spec.ts", false)).toBe(false);
  });

  it("matches a single character with ?", () => {
    const ig = ignorer("a?c.ts");
    expect(ig.matches("a1c.ts", false)).toBe(true);
    expect(ig.matches("abbc.ts", false)).toBe(false);
  });

  it("treats regex metacharacters in a pattern as literals", () => {
    const ig = ignorer("a.b.ts", "x+y.ts", "(paren).ts");
    expect(ig.matches("a.b.ts", false)).toBe(true);
    expect(ig.matches("aXbYts", false)).toBe(false);
    expect(ig.matches("x+y.ts", false)).toBe(true);
    expect(ig.matches("xy.ts", false)).toBe(false);
    expect(ig.matches("(paren).ts", false)).toBe(true);
  });

  it("does not match a prefix of a longer name", () => {
    const ig = ignorer("src/a.ts");
    expect(ig.matches("src/a.ts.bak", false)).toBe(false);
  });

  it("applies any of several rules", () => {
    const ig = ignorer("dist/", "*.gen.ts");
    expect(ig.matches("dist", true)).toBe(true);
    expect(ig.matches("src/x.gen.ts", false)).toBe(true);
    expect(ig.matches("src/x.ts", false)).toBe(false);
  });
});

describe("hostile patterns", () => {
  // A checked in .motion-a11yignore is written by whoever opened the pull
  // request, so these patterns are untrusted input on a CI run.
  it("collapses runs of stars so no two unbounded quantifiers meet", () => {
    expect(normalisePattern("*".repeat(200) + "x")).toBe("*x");
    expect(normalisePattern("**".repeat(40) + "x")).toBe("*x");
    expect(normalisePattern("**/**/**/**/x")).toBe("**/x");
    expect(normalisePattern("a**b")).toBe("a*b");
  });

  it("leaves a legitimate pattern untouched", () => {
    expect(normalisePattern("src/**/*.spec.ts")).toBe("src/**/*.spec.ts");
    expect(normalisePattern("**")).toBe("**");
    expect(normalisePattern("dist")).toBe("dist");
  });

  it("does not backtrack exponentially on a near miss", () => {
    const cases: Array<[string, string]> = [
      ["*".repeat(200) + "x", "a".repeat(200)],
      ["**".repeat(40) + "x", "a/".repeat(60) + "b"],
      ["a" + "**/".repeat(50) + "b", "a/" + "x/".repeat(50) + "c"],
      ["**/".repeat(60) + "x", "a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q"],
    ];
    const started = performance.now();
    for (const [pattern, path] of cases) {
      const ig = new Ignorer([parseIgnorePattern(pattern)!]);
      for (let i = 0; i < 200; i++) ig.matches(path, false);
    }
    // Before normalisation this did not finish at all. A generous ceiling is
    // still many orders of magnitude below a catastrophic match.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("refuses an absurdly long pattern rather than compiling it", () => {
    expect(() => parseIgnorePattern("a".repeat(2000))).toThrow(/too long/);
  });
});
