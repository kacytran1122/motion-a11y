import { describe, expect, it } from "vitest";
import { lint } from "../src/index.js";
import type { RuleId } from "../src/types.js";

const rules = (code: string, filename = "input.tsx"): RuleId[] =>
  lint(code, { filename }).messages.map((m) => m.rule);

describe("require-reduced-motion-guard", () => {
  it("flags framer-motion JSX with no guard", () => {
    const code = `
      import { motion } from "framer-motion";
      export const Box = () => <motion.div animate={{ x: 100 }} />;
    `;
    expect(rules(code)).toContain("require-reduced-motion-guard");
  });

  it("stays quiet when useReducedMotion is present", () => {
    const code = `
      import { motion, useReducedMotion } from "framer-motion";
      export const Box = () => {
        const reduce = useReducedMotion();
        return <motion.div animate={reduce ? {} : { x: 100 }} />;
      };
    `;
    expect(rules(code)).not.toContain("require-reduced-motion-guard");
  });

  it("accepts a media query string as a guard", () => {
    const code = `
      import { animate } from "motion";
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) animate(".box", { opacity: 1 });
    `;
    expect(rules(code, "a.ts")).not.toContain("require-reduced-motion-guard");
  });

  it("reports once per file rather than once per animation", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".a", { x: 10 });
      gsap.to(".b", { x: 20 });
      gsap.to(".c", { x: 30 });
    `;
    const guards = rules(code, "a.ts").filter((r) => r === "require-reduced-motion-guard");
    expect(guards).toHaveLength(1);
  });

  it("ignores a mention inside a comment", () => {
    const code = `
      import gsap from "gsap";
      // TODO: handle prefers-reduced-motion later
      gsap.to(".a", { x: 10 });
    `;
    expect(rules(code, "a.ts")).toContain("require-reduced-motion-guard");
  });
});

describe("no-infinite-animation", () => {
  it("flags repeat Infinity in framer-motion", () => {
    const code = `
      import { motion } from "framer-motion";
      export const Spinner = () => (
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2 }} />
      );
    `;
    expect(rules(code)).toContain("no-infinite-animation");
  });

  it("flags repeat -1 in gsap", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".pulse", { scale: 1.1, duration: 1, repeat: -1 });
    `;
    expect(rules(code, "a.ts")).toContain("no-infinite-animation");
  });

  it("flags iterations Infinity in the Web Animations API", () => {
    const code = `
      el.animate([{ transform: "scale(1)" }, { transform: "scale(2)" }], {
        duration: 1000,
        iterations: Infinity,
      });
    `;
    expect(rules(code, "a.js")).toContain("no-infinite-animation");
  });

  it("stays quiet when the file exposes a pause control", () => {
    const code = `
      import gsap from "gsap";
      const tween = gsap.to(".pulse", { scale: 1.1, duration: 1, repeat: -1 });
      button.addEventListener("click", () => tween.pause());
    `;
    expect(rules(code, "a.ts")).not.toContain("no-infinite-animation");
  });
});

describe("no-fast-flash", () => {
  it("flags an opacity strobe faster than three times a second", () => {
    const code = `
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, iterations: Infinity });
    `;
    const messages = lint(code, { filename: "a.js" }).messages;
    const flash = messages.find((m) => m.rule === "no-fast-flash");
    expect(flash).toBeDefined();
    expect(flash?.wcag).toContain("2.3.1");
  });

  it("still reports even when the file has a reduced motion guard", () => {
    const code = `
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100, iterations: Infinity });
    `;
    expect(rules(code, "a.js")).toContain("no-fast-flash");
  });

  it("ignores fast transform loops, which do not flash", () => {
    const code = `
      el.animate([{ transform: "translateX(0)" }, { transform: "translateX(4px)" }], {
        duration: 100,
        iterations: Infinity,
      });
    `;
    expect(rules(code, "a.js")).not.toContain("no-fast-flash");
  });
});

describe("no-long-animation", () => {
  it("flags an animation over five seconds", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".hero", { x: 400, duration: 12 });
    `;
    expect(rules(code, "a.ts")).toContain("no-long-animation");
  });

  it("reads Web Animations API durations as milliseconds", () => {
    const code = `el.animate([{ opacity: 0 }], { duration: 3000 });`;
    expect(rules(code, "a.js")).not.toContain("no-long-animation");
  });

  it("reads gsap durations as seconds", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".hero", { x: 1, duration: 3 });
    `;
    expect(rules(code, "a.ts")).not.toContain("no-long-animation");
  });
});

describe("no-scroll-linked-animation", () => {
  it("flags useScroll", () => {
    const code = `
      import { useScroll, motion } from "framer-motion";
      export const Bar = () => {
        const { scrollYProgress } = useScroll();
        return <motion.div style={{ scaleX: scrollYProgress }} />;
      };
    `;
    expect(rules(code)).toContain("no-scroll-linked-animation");
  });

  it("flags a gsap scrollTrigger config", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".layer", { y: -200, scrollTrigger: { trigger: ".layer", scrub: true } });
    `;
    expect(rules(code, "a.ts")).toContain("no-scroll-linked-animation");
  });
});

describe("no-smooth-scroll", () => {
  it("flags scrollIntoView with smooth behavior", () => {
    const code = `document.querySelector("#top").scrollIntoView({ behavior: "smooth" });`;
    expect(rules(code, "a.js")).toContain("no-smooth-scroll");
  });

  it("flags scrollBehavior set from JavaScript", () => {
    const code = `document.documentElement.style.scrollBehavior = "smooth";`;
    expect(rules(code, "a.js")).toContain("no-smooth-scroll");
  });

  it("ignores instant scrolling", () => {
    const code = `window.scrollTo({ top: 0, behavior: "auto" });`;
    expect(rules(code, "a.js")).toHaveLength(0);
  });
});

describe("no-autoplay-lottie", () => {
  it("flags an autoplaying looping player", () => {
    const code = `
      import Lottie from "lottie-react";
      export const Hero = () => <Lottie animationData={data} loop autoplay />;
    `;
    expect(rules(code)).toContain("no-autoplay-lottie");
  });

  it("flags loadAnimation with autoplay true", () => {
    const code = `
      import lottie from "lottie-web";
      lottie.loadAnimation({ container: el, autoplay: true, loop: true, path: "a.json" });
    `;
    expect(rules(code, "a.ts")).toContain("no-autoplay-lottie");
  });

  it("ignores a player that waits for the user", () => {
    const code = `
      import Lottie from "lottie-react";
      export const Hero = () => <Lottie animationData={data} autoplay={false} />;
    `;
    expect(rules(code)).not.toContain("no-autoplay-lottie");
  });
});

describe("engine", () => {
  it("returns positions that point at the real source location", () => {
    const code = ["import gsap from 'gsap';", "", "gsap.to('.a', { x: 10 });"].join("\n");
    const message = lint(code, { filename: "a.ts" }).messages[0]!;
    expect(message.line).toBe(3);
    expect(message.column).toBe(1);
  });

  it("respects rule overrides", () => {
    const code = `document.body.scrollIntoView({ behavior: "smooth" });`;
    const off = lint(code, { filename: "a.js", rules: { "no-smooth-scroll": "off" } });
    expect(off.messages).toHaveLength(0);
  });

  it("raises severity under the strict preset", () => {
    const code = `document.body.scrollIntoView({ behavior: "smooth" });`;
    expect(lint(code, { filename: "a.js", preset: "strict" }).errorCount).toBe(1);
    expect(lint(code, { filename: "a.js", preset: "recommended" }).warningCount).toBe(1);
  });

  it("reports a parse error instead of throwing", () => {
    const result = lint("import gsap from 'gsap'; const = = =", { filename: "broken.ts" });
    expect(result.messages).toHaveLength(0);
    expect(result.parseError ?? "").not.toBe("");
  });

  it("parses every file when the prefilter is switched off", () => {
    const result = lint("const = = =", { filename: "broken.ts", prefilter: false });
    expect(result.parseError ?? "").not.toBe("");
  });

  it("finds nothing in a file with no animation", () => {
    const code = `export const add = (a: number, b: number) => a + b;`;
    expect(lint(code, { filename: "a.ts" }).messages).toHaveLength(0);
  });
});
