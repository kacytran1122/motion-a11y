import { describe, it } from "node:test";
import { expect } from "./expect.js";
import { lint } from "../src/index.js";
import { parseComment, SuppressionMap } from "../src/suppress.js";
import type { RuleId } from "../src/types.js";

const rules = (code: string, filename = "a.ts"): RuleId[] =>
  lint(code, { filename }).messages.map((m) => m.rule);

const ENDLESS = `import gsap from "gsap";\ngsap.to(".a", { x: 1, repeat: -1 });`;

describe("parseComment", () => {
  it("reads every directive shape", () => {
    expect(parseComment(" motion-a11y-disable-next-line", 1)?.directive).toBe("disable-next-line");
    expect(parseComment(" motion-a11y-disable-line", 1)?.directive).toBe("disable-line");
    expect(parseComment(" motion-a11y-disable", 1)?.directive).toBe("disable");
    expect(parseComment(" motion-a11y-enable", 1)?.directive).toBe("enable");
  });

  it("does not read disable-next-line as disable", () => {
    const parsed = parseComment(" motion-a11y-disable-next-line no-long-animation", 1)!;
    expect(parsed.directive).toBe("disable-next-line");
    expect(parsed.rules).toEqual(["no-long-animation"]);
  });

  it("splits rules on commas and spaces", () => {
    const parsed = parseComment(" motion-a11y-disable-line no-long-animation, no-fast-flash", 3)!;
    expect(parsed.rules).toEqual(["no-long-animation", "no-fast-flash"]);
    expect(parsed.line).toBe(3);
  });

  it("ignores comments that are not directives", () => {
    expect(parseComment(" TODO: motion-a11y-disable later", 1)).toBeNull();
    expect(parseComment(" disable this", 1)).toBeNull();
    expect(parseComment(" motion-a11y-something-else", 1)).toBeNull();
    expect(parseComment("", 1)).toBeNull();
  });
});

describe("SuppressionMap", () => {
  it("costs nothing when a file has no directives", () => {
    const map = new SuppressionMap(
      [{ value: " ordinary comment", loc: { start: { line: 1 } } }],
      10,
    );
    expect(map.empty).toBe(true);
    expect(map.isSuppressed("no-long-animation", 1)).toBe(false);
  });

  it("survives comments with no position", () => {
    const map = new SuppressionMap([{ value: " motion-a11y-disable" }, null], 10);
    expect(map.empty).toBe(true);
  });
});

describe("inline suppression", () => {
  it("does nothing without a directive", () => {
    expect(rules(ENDLESS)).toContain("no-infinite-animation");
  });

  it("disable-next-line silences every rule on the next line", () => {
    const code = `import gsap from "gsap";\n// motion-a11y-disable-next-line\ngsap.to(".a", { x: 1, repeat: -1 });`;
    const result = lint(code, { filename: "a.ts" });
    expect(result.messages).toHaveLength(0);
    expect(result.suppressedCount).toBe(2);
  });

  it("disable-next-line silences only the rules it names", () => {
    const code = `import gsap from "gsap";\n// motion-a11y-disable-next-line no-infinite-animation\ngsap.to(".a", { x: 1, repeat: -1 });`;
    const found = rules(code);
    expect(found).not.toContain("no-infinite-animation");
    expect(found).toContain("require-reduced-motion-guard");
  });

  it("does not silence a rule it does not name", () => {
    const code = `import gsap from "gsap";\n// motion-a11y-disable-next-line no-smooth-scroll\ngsap.to(".a", { x: 1, repeat: -1 });`;
    expect(rules(code)).toContain("no-infinite-animation");
  });

  it("disable-line silences the line it sits on", () => {
    const code = `import gsap from "gsap";\ngsap.to(".a", { x: 1, repeat: -1 }); // motion-a11y-disable-line`;
    expect(lint(code, { filename: "a.ts" }).messages).toHaveLength(0);
  });

  it("does not leak onto neighbouring lines", () => {
    const code = [
      `import gsap from "gsap";`,
      `// motion-a11y-disable-next-line`,
      `gsap.to(".a", { x: 1, repeat: -1 });`,
      `gsap.to(".b", { x: 1, repeat: -1 });`,
    ].join("\n");
    const result = lint(code, { filename: "a.ts" });
    expect(result.messages.map((m) => m.line)).toEqual([4]);
  });

  it("a block disable runs to the end of the file", () => {
    const code = `/* motion-a11y-disable */\nimport gsap from "gsap";\ngsap.to(".a", { x: 1, repeat: -1 });`;
    expect(lint(code, { filename: "a.ts" }).messages).toHaveLength(0);
  });

  it("enable switches reporting back on", () => {
    const code = [
      `/* motion-a11y-disable */`,
      `import gsap from "gsap";`,
      `gsap.to(".a", { x: 1, repeat: -1 });`,
      `/* motion-a11y-enable */`,
      `gsap.to(".b", { x: 1, repeat: -1 });`,
    ].join("\n");
    const result = lint(code, { filename: "a.ts" });
    expect(result.messages.every((m) => m.line >= 5)).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("a block disable can name one rule and leave the rest reporting", () => {
    const code = [
      `/* motion-a11y-disable no-infinite-animation */`,
      `import gsap from "gsap";`,
      `gsap.to(".a", { x: 1, repeat: -1 });`,
    ].join("\n");
    const found = rules(code);
    expect(found).not.toContain("no-infinite-animation");
    expect(found).toContain("require-reduced-motion-guard");
  });

  it("can silence the flash rule, which a guard deliberately cannot", () => {
    // Inline suppression is a reviewed, local decision; a motion preference is
    // not. Refusing it here would only push people to switch the rule off
    // across the whole project, which is strictly worse.
    const code = `// motion-a11y-disable-next-line no-fast-flash\nel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100, iterations: Infinity });`;
    expect(rules(code, "a.js")).not.toContain("no-fast-flash");
  });

  it("counts suppressions without reporting them", () => {
    const code = `import gsap from "gsap";\n// motion-a11y-disable-next-line\ngsap.to(".a", { x: 1, repeat: -1 });`;
    const result = lint(code, { filename: "a.ts" });
    expect(result.suppressedCount).toBe(2);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it("reports zero suppressions for an ordinary file", () => {
    expect(lint(ENDLESS, { filename: "a.ts" }).suppressedCount).toBe(0);
  });

  it("works in JSX files too", () => {
    const code = [
      `import { motion } from "framer-motion";`,
      `export const A = () => (`,
      `  // motion-a11y-disable-next-line`,
      `  <motion.div animate={{ x: 1 }} />`,
      `);`,
    ].join("\n");
    expect(lint(code, { filename: "a.tsx" }).messages).toHaveLength(0);
  });
});
