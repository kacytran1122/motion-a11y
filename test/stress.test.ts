import { describe, it } from "node:test";
import { expect } from "./expect.js";
import { lint } from "../src/index.js";

/** Every one of these has crashed a linter somewhere. None may throw. */
const MALFORMED = [
  "",
  " ",
  "\n\n\n",
  "\u0000",
  "\ufeffimport gsap from 'gsap'; gsap.to('.a', { x: 1 });",
  "#!/usr/bin/env node\nimport gsap from 'gsap';\ngsap.to('.a', { x: 1 });",
  "gsap.to(",
  "gsap.to(.a, { x: });",
  "const = = =",
  "<<<<<<< HEAD\nimport gsap from 'gsap';\n=======\n>>>>>>> other",
  "/* unterminated comment\nimport gsap from 'gsap';",
  "`unterminated template ${",
  "el.animate([{ opacity: 0 }], { duration: NaN, iterations: Infinity });",
  "el.animate([{ opacity: 0 }], { duration: 1e400, iterations: Infinity });",
  "el.animate([{ opacity: 0 }], { duration: -0, iterations: Infinity });",
  "el.animate([{ opacity: 0 }], { duration: 0.0000001, iterations: Infinity });",
  "el.animate(null, null);",
  "el.animate();",
  "import gsap from 'gsap'; gsap.to(...targets, ...vars);",
  "import gsap from 'gsap'; gsap.to('.a', { ...shared, duration: 12 });",
  "import gsap from 'gsap'; gsap.to('.a', { [key]: 1, duration: 12 });",
  "import Lottie from 'lottie-react'; export const A = () => <Lottie {...props} />;",
  "import { motion } from 'framer-motion'; export const A = () => <motion.div {...rest} />;",
  "scroll(); scrollTo(); scrollBy(); scrollIntoView();",
  "document.documentElement.style.scrollBehavior = undefined;",
  "const scrollBehavior = 'smooth';",
];

describe("malformed and hostile input", () => {
  for (const [index, code] of MALFORMED.entries()) {
    it(`survives sample ${index}`, () => {
      for (const filename of ["a.ts", "a.tsx", "a.js", "a.mjs", "noext"]) {
        const result = lint(code, { filename });
        expect(Array.isArray(result.messages)).toBe(true);
        expect(result.errorCount).toBe(
          result.messages.filter((m) => m.severity === "error").length,
        );
        for (const message of result.messages) {
          expect(message.line).toBeGreaterThanOrEqual(1);
          expect(message.column).toBeGreaterThanOrEqual(1);
          expect(Number.isFinite(message.line)).toBe(true);
          expect(message.message).not.toContain("NaN");
          expect(message.message).not.toContain("Infinity times");
        }
      }
    });
  }
});

describe("pathological shapes", () => {
  it("reports a stack overflow in the parser instead of throwing", () => {
    // Babel's recursive descent parser gives up somewhere past 250 levels.
    // What matters is that one hostile file does not take down the whole run.
    const depth = 400;
    const code = `import gsap from "gsap";\ngsap.to(".a", ${"{ nested: ".repeat(depth)}{ duration: 12 }${" }".repeat(depth)});`;
    const result = lint(code, { filename: "a.ts" });
    expect(result.parseError ?? result.analysisError ?? "").not.toBe("");
    expect(result.messages).toHaveLength(0);
  });

  it("walks a nesting depth the parser can actually produce", () => {
    const depth = 200;
    const code = `import gsap from "gsap";\ngsap.to(".a", ${"{ nested: ".repeat(depth)}{ duration: 12 }${" }".repeat(depth)});`;
    const result = lint(code, { filename: "a.ts" });
    expect(result.parseError).toBeUndefined();
    expect(result.analysisError).toBeUndefined();
    expect(result.messages.map((m) => m.rule)).toContain("require-reduced-motion-guard");
  });

  it("handles a deeply nested JSX tree", () => {
    const depth = 200;
    const code = `import { motion } from "framer-motion";
      export const A = () => (${"<div>".repeat(depth)}<motion.div animate={{ x: 1 }} />${"</div>".repeat(depth)});`;
    const result = lint(code, { filename: "a.tsx" });
    expect(result.messages.map((m) => m.rule)).toContain("require-reduced-motion-guard");
  });

  it("resolves every link of a very long gsap timeline chain", () => {
    const links = 500;
    // Each link is long enough to trip no-long-animation, so the count of
    // findings shows how much of the chain was actually followed.
    const code = `import gsap from "gsap";\ngsap.timeline()${".to('.a', { x: 1, duration: 12 })".repeat(links)};`;
    const started = performance.now();
    const result = lint(code, { filename: "a.ts" });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(result.messages.filter((m) => m.rule === "no-long-animation")).toHaveLength(links);
  });

  it("resolves a long chain of timelines held in locals", () => {
    const links = 300;
    const lines = ['import gsap from "gsap";', "const t0 = gsap.timeline();"];
    for (let i = 1; i < links; i++) lines.push(`const t${i} = t${i - 1}.timeline();`);
    // Declared last, used against the first local, so order cannot be relied on.
    lines.push(`t${links - 1}.to(".a", { x: 1, duration: 12 });`);
    const result = lint(lines.join("\n"), { filename: "a.ts" });
    expect(result.messages.map((m) => m.rule)).toContain("no-long-animation");
  });

  it("resolves a timeline used before it is declared", () => {
    const code = `
      import gsap from "gsap";
      export function play() { tl.to(".a", { x: 1, duration: 12 }); }
      const tl = gsap.timeline();
    `;
    expect(lint(code, { filename: "a.ts" }).messages.map((m) => m.rule)).toContain(
      "no-long-animation",
    );
  });

  it("handles many sibling animations", () => {
    const count = 2000;
    const code = `import gsap from "gsap";\n${Array.from(
      { length: count },
      (_, i) => `gsap.to(".a${i}", { x: ${i}, duration: 12 });`,
    ).join("\n")}`;
    const result = lint(code, { filename: "a.ts" });
    const guards = result.messages.filter((m) => m.rule === "require-reduced-motion-guard");
    expect(guards).toHaveLength(1);
    expect(guards[0]!.message).toContain(`${count} animations`);
    expect(result.messages.filter((m) => m.rule === "no-long-animation")).toHaveLength(count);
  });

  it("keeps messages sorted by position", () => {
    const code = `import gsap from "gsap";\n${Array.from(
      { length: 200 },
      (_, i) => `gsap.to(".a${i}", { x: 1, duration: 12, repeat: -1 });`,
    ).join("\n")}`;
    const { messages } = lint(code, { filename: "a.ts" });
    for (let i = 1; i < messages.length; i++) {
      const previous = messages[i - 1]!;
      const current = messages[i]!;
      expect(
        current.line > previous.line ||
          (current.line === previous.line && current.column >= previous.column),
      ).toBe(true);
    }
  });
});

describe("scaling and stability", () => {
  it("stays roughly linear as the file grows", () => {
    const block = `
      export function helper(a, b) { return [a, b].map((n) => n * 2).reduce((x, y) => x + y, 0); }
      const shape = { id: "s", width: 1, height: 2, tags: ["a", "b"] };
    `;
    const time = (repeats: number): number => {
      const code = `import gsap from "gsap";\ngsap.to(".a", { x: 1 });\n${block.repeat(repeats)}`;
      lint(code, { filename: "a.ts" }); // warm
      const started = performance.now();
      for (let i = 0; i < 5; i++) lint(code, { filename: "a.ts" });
      return (performance.now() - started) / 5;
    };
    const small = time(50);
    const large = time(400);
    // Eight times the input should not cost much more than eight times the time.
    // The bound is loose because a shared CI runner is noisy.
    expect(large / Math.max(small, 0.05)).toBeLessThan(24);
  });

  it("does not retain memory across runs", () => {
    const code = `import gsap from "gsap";\n${Array.from(
      { length: 200 },
      (_, i) => `gsap.to(".a${i}", { x: ${i}, duration: 12, repeat: -1 });`,
    ).join("\n")}`;

    for (let i = 0; i < 20; i++) lint(code, { filename: "a.ts" });
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200; i++) lint(code, { filename: "a.ts" });
    const after = process.memoryUsage().heapUsed;
    // Anything retained per run would show up as growth far larger than this.
    expect(after - before).toBeLessThan(200 * 1024 * 1024);
  });

  it("produces identical results when run repeatedly", () => {
    const code = `
      import gsap from "gsap";
      import Lottie from "lottie-react";
      const tl = gsap.timeline();
      tl.to(".a", { x: 1, duration: 12 });
      export const A = () => <Lottie animationData={d} />;
    `;
    const first = JSON.stringify(lint(code, { filename: "a.tsx" }));
    for (let i = 0; i < 20; i++) {
      expect(JSON.stringify(lint(code, { filename: "a.tsx" }))).toBe(first);
    }
  });
});
