import { describe, it } from "node:test";
import { expect } from "./expect.js";
import { lint, lintAst } from "../src/index.js";
import { parseFile } from "../src/ast.js";
import { collect } from "../src/collect.js";

/**
 * A tree the walker cannot get through: reading the `boom` key throws. One
 * unusual file must never take down a run over a whole repository, so this
 * proves the analysis phase is wrapped rather than left to propagate.
 */
function hostileAst(): unknown {
  return {
    type: "File",
    program: { type: "Program", body: [] },
    get boom(): never {
      throw new Error("analyser exploded");
    },
  };
}

describe("analysis failure", () => {
  it("really does throw out of collect", () => {
    expect(() => collect(hostileAst())).toThrow(/analyser exploded/);
  });

  it("is reported per file instead of thrown", () => {
    const result = lintAst(hostileAst(), `gsap.to(".a", { x: 1 });`, { filename: "a.ts" });
    expect(result.analysisError).toContain("analyser exploded");
    expect(result.messages).toHaveLength(0);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.parseError).toBeUndefined();
  });

  it("does not disturb a healthy file", () => {
    const code = `import gsap from "gsap";\ngsap.to(".a", { x: 1, repeat: -1 });`;
    const result = lintAst(parseFile(code, "a.ts"), code, { filename: "a.ts" });
    expect(result.analysisError).toBeUndefined();
    expect(result.messages.map((m) => m.rule)).toContain("no-infinite-animation");
  });

  it("gives lintAst the same answer as lint", () => {
    const code = `import gsap from "gsap";\ngsap.to(".a", { x: 1, duration: 12, repeat: -1 });`;
    const viaSource = lint(code, { filename: "a.ts" });
    const viaAst = lintAst(parseFile(code, "a.ts"), code, { filename: "a.ts" });
    expect(JSON.stringify(viaAst)).toBe(JSON.stringify(viaSource));
  });

  it("still short circuits a file with no animation marker", () => {
    const result = lint(`export const add = (a, b) => a + b;`, { filename: "a.ts" });
    expect(result.analysisError).toBeUndefined();
    expect(result.messages).toHaveLength(0);
  });
});
