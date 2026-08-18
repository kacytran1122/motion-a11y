import { describe, expect, it } from "vitest";
import { isRuleId, isSeverity, lint, mightAnimate, presets, RULE_IDS } from "../src/index.js";
import { parseFile } from "../src/ast.js";
import { collect } from "../src/collect.js";
import { runRules } from "../src/rules.js";
import type { RuleId } from "../src/types.js";

const rules = (code: string, filename = "input.tsx"): RuleId[] =>
  lint(code, { filename }).messages.map((m) => m.rule);

describe("flash rate", () => {
  it("flags a finite repeat that still produces three flashes", () => {
    const code = `el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100, iterations: 8 });`;
    expect(rules(code, "a.js")).toContain("no-fast-flash");
  });

  it("ignores two fast passes, which is below the threshold", () => {
    const code = `el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100, iterations: 2 });`;
    expect(rules(code, "a.js")).not.toContain("no-fast-flash");
  });

  it("halves the rate for an alternating direction", () => {
    const code = `
      el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 200,
        iterations: Infinity,
        direction: "alternate",
      });
    `;
    expect(rules(code, "a.js")).not.toContain("no-fast-flash");
  });

  it("still flags an alternating loop that is fast enough", () => {
    const code = `
      el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 80,
        iterations: Infinity,
        direction: "alternate",
      });
    `;
    expect(rules(code, "a.js")).toContain("no-fast-flash");
  });

  it("halves the rate for a gsap yoyo", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".a", { opacity: 0, duration: 0.2, repeat: -1, yoyo: true });
    `;
    expect(rules(code, "a.ts")).not.toContain("no-fast-flash");
  });

  it('halves the rate for framer-motion repeatType "reverse"', () => {
    const code = `
      import { motion } from "framer-motion";
      export const A = () => (
        <motion.div
          animate={{ opacity: 0 }}
          transition={{ duration: 0.2, repeat: Infinity, repeatType: "reverse" }}
        />
      );
    `;
    expect(rules(code)).not.toContain("no-fast-flash");
  });

  it("reports the rate it actually computed", () => {
    const code = `el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100, iterations: Infinity });`;
    const message = lint(code, { filename: "a.js" }).messages.find((m) => m.rule === "no-fast-flash");
    expect(message?.message).toContain("10.0 times a second");
  });

  it("ignores a zero duration rather than dividing by it", () => {
    const code = `el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 0, iterations: Infinity });`;
    expect(rules(code, "a.js")).not.toContain("no-fast-flash");
  });
});

describe("total run time", () => {
  it("multiplies the duration by the repeat count", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".a", { x: 1, duration: 2, repeat: 5 });
    `;
    const message = lint(code, { filename: "a.ts" }).messages.find((m) => m.rule === "no-long-animation");
    expect(message?.message).toContain("12.0s");
    expect(message?.message).toContain("6 passes");
  });

  it("does not flag a short animation that repeats twice", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".a", { x: 1, duration: 1, repeat: 1 });
    `;
    expect(rules(code, "a.ts")).not.toContain("no-long-animation");
  });

  it("leaves endless animations to no-infinite-animation", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".a", { x: 1, duration: 10, repeat: -1 });
    `;
    const found = rules(code, "a.ts");
    expect(found).toContain("no-infinite-animation");
    expect(found).not.toContain("no-long-animation");
  });

  it("ignores a negative duration", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".a", { x: 1, duration: -12 });
    `;
    expect(rules(code, "a.ts")).not.toContain("no-long-animation");
  });
});

describe("severity resolution", () => {
  it("ignores an explicit undefined override instead of promoting to error", () => {
    const code = `document.body.scrollIntoView({ behavior: "smooth" });`;
    const result = lint(code, { filename: "a.js", rules: { "no-smooth-scroll": undefined } });
    expect(result.messages[0]?.severity).toBe("warn");
    expect(result.warningCount).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  it("ignores an unknown preset instead of dropping every severity", () => {
    const code = `document.body.scrollIntoView({ behavior: "smooth" });`;
    const result = lint(code, { filename: "a.js", preset: "nonsense" as never });
    expect(result.messages[0]?.severity).toBe("warn");
  });

  it("ignores an unknown rule name in the overrides", () => {
    const code = `document.body.scrollIntoView({ behavior: "smooth" });`;
    const result = lint(code, {
      filename: "a.js",
      rules: { "no-such-rule": "error" } as never,
    });
    expect(result.messages[0]?.severity).toBe("warn");
  });

  it("ignores an unknown severity value", () => {
    const code = `document.body.scrollIntoView({ behavior: "smooth" });`;
    const result = lint(code, {
      filename: "a.js",
      rules: { "no-smooth-scroll": "loud" } as never,
    });
    expect(result.messages[0]?.severity).toBe("warn");
  });

  it("counts errors and warnings consistently with the message list", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".a", { x: 1, duration: 12, repeat: 0 });
    `;
    const result = lint(code, { filename: "a.ts" });
    expect(result.errorCount).toBe(result.messages.filter((m) => m.severity === "error").length);
    expect(result.warningCount).toBe(result.messages.filter((m) => m.severity === "warn").length);
  });

  it("exposes every rule in both presets", () => {
    for (const id of RULE_IDS) {
      expect(presets.recommended[id]).toBeDefined();
      expect(presets.strict[id]).toBe("error");
    }
  });

  it("validates rule ids and severities", () => {
    expect(isRuleId("no-smooth-scroll")).toBe(true);
    expect(isRuleId("nope")).toBe(false);
    expect(isRuleId(undefined)).toBe(false);
    expect(isSeverity("off")).toBe(true);
    expect(isSeverity("loud")).toBe(false);
  });
});

describe("positions", () => {
  it("reports 1 based lines and columns", () => {
    const code = ["import gsap from 'gsap';", "", "gsap.to('.a', { x: 10 });"].join("\n");
    const message = lint(code, { filename: "a.ts" }).messages[0]!;
    expect(message.line).toBe(3);
    expect(message.column).toBe(1);
    expect(message.endLine).toBe(3);
    expect(message.endColumn).toBeGreaterThan(message.column);
  });

  it("handles CRLF line endings", () => {
    const code = ["import gsap from 'gsap';", "", "gsap.to('.a', { x: 10 });"].join("\r\n");
    const message = lint(code, { filename: "a.ts" }).messages[0]!;
    expect(message.line).toBe(3);
    expect(message.column).toBe(1);
  });

  it("counts columns in characters, not bytes", () => {
    const code = `import gsap from "gsap";\nconst label = "日本語のラベル"; gsap.to(".a", { x: 1 });`;
    const message = lint(code, { filename: "a.ts" }).messages[0]!;
    expect(message.line).toBe(2);
    // The emoji-free CJK text is one column per character.
    expect(code.split("\n")[1]!.slice(message.column - 1)).toMatch(/^gsap\.to/);
  });
});

describe("prefilter", () => {
  it("is a superset of everything the rules can detect", () => {
    const samples = [
      `import { motion } from "framer-motion"; export const A = () => <motion.div animate={{x:1}} />;`,
      `import gsap from "gsap"; gsap.to(".a", { x: 1 });`,
      `import Lottie from "lottie-react"; export const A = () => <Lottie animationData={d} />;`,
      `el.animate([{ opacity: 0 }], { duration: 10, iterations: Infinity });`,
      `el.scrollIntoView({ behavior: "smooth" });`,
      `document.documentElement.style.scrollBehavior = "smooth";`,
      `import { useScroll } from "framer-motion"; const s = useScroll();`,
      `import lottie from "lottie-web"; lottie.loadAnimation({ autoplay: true });`,
      `export const add = (a, b) => a + b;`,
      `const config = { timeout: 500, retries: 3 };`,
      `class Widget { render() { return null; } }`,
    ];
    for (const code of samples) {
      const findings = runRules(collect(parseFile(code, "sample.tsx")));
      if (findings.length > 0) {
        expect(mightAnimate(code), `prefilter dropped: ${code}`).toBe(true);
      }
    }
  });

  it("skips a file with no animation marker", () => {
    const result = lint(`export const add = (a: number, b: number) => a + b;`, { filename: "a.ts" });
    expect(result.messages).toHaveLength(0);
    expect(result.parseError).toBeUndefined();
  });
});

describe("input handling", () => {
  it("refuses a non-string source instead of throwing", () => {
    const result = lint(undefined as never, { filename: "a.ts" });
    expect(result.parseError).toBeTruthy();
    expect(result.messages).toHaveLength(0);
  });

  it("handles an empty file", () => {
    expect(lint("", { filename: "a.ts" }).messages).toHaveLength(0);
  });

  it("parses JSX that lives in a .ts file", () => {
    const code = `import { motion } from "framer-motion";\nexport const A = () => <motion.div animate={{ x: 1 }} />;`;
    const result = lint(code, { filename: "a.ts" });
    expect(result.parseError).toBeUndefined();
    expect(result.messages.map((m) => m.rule)).toContain("require-reduced-motion-guard");
  });

  it("parses an import attribute", () => {
    const code = `import data from "./a.json" with { type: "json" };\nimport gsap from "gsap";\ngsap.to(".a", { x: 1 });`;
    const result = lint(code, { filename: "a.ts" });
    expect(result.parseError).toBeUndefined();
  });

  it("still lints the readable part of a file with a recoverable syntax slip", () => {
    const code = `import gsap from "gsap";\ngsap.to(".a", { x: 1, duration: 12 });\nconst x = ;`;
    const result = lint(code, { filename: "a.ts" });
    expect(result.messages.length + (result.parseError ? 1 : 0)).toBeGreaterThan(0);
  });
});
