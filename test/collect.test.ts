import { describe, expect, it } from "vitest";
import { lint } from "../src/index.js";
import type { RuleId } from "../src/types.js";

const rules = (code: string, filename = "input.tsx"): RuleId[] =>
  lint(code, { filename }).messages.map((m) => m.rule);

describe("guard detection", () => {
  it("does not treat a type declaration as a guard", () => {
    const code = `
      import gsap from "gsap";
      type Options = { reducedMotion: boolean };
      gsap.to(".a", { x: 1, repeat: -1 });
    `;
    expect(rules(code, "a.ts")).toContain("require-reduced-motion-guard");
  });

  it("does not treat reducedMotion: false as a guard", () => {
    const code = `
      import gsap from "gsap";
      const config = { reducedMotion: false };
      gsap.to(".a", { x: 1, repeat: -1 });
    `;
    expect(rules(code, "a.ts")).toContain("require-reduced-motion-guard");
  });

  it("treats reducedMotion: true as a guard", () => {
    const code = `
      import gsap from "gsap";
      const config = { reducedMotion: true };
      gsap.to(".a", { x: 1, repeat: -1 });
    `;
    expect(rules(code, "a.ts")).not.toContain("require-reduced-motion-guard");
  });

  it('does not treat <MotionConfig reducedMotion="never"> as a guard', () => {
    const code = `
      import { MotionConfig, motion } from "framer-motion";
      export const App = () => (
        <MotionConfig reducedMotion="never">
          <motion.div animate={{ x: 1 }} />
        </MotionConfig>
      );
    `;
    expect(rules(code)).toContain("require-reduced-motion-guard");
  });

  it('accepts <MotionConfig reducedMotion="user"> as a guard', () => {
    const code = `
      import { MotionConfig, motion } from "framer-motion";
      export const App = () => (
        <MotionConfig reducedMotion="user">
          <motion.div animate={{ x: 1 }} />
        </MotionConfig>
      );
    `;
    expect(rules(code)).not.toContain("require-reduced-motion-guard");
  });

  it("does not count an unused import as a guard", () => {
    const code = `
      import { motion, useReducedMotion } from "framer-motion";
      export const Box = () => <motion.div animate={{ x: 1 }} />;
    `;
    expect(rules(code)).toContain("require-reduced-motion-guard");
  });

  it("reads a guard out of a member expression", () => {
    const code = `
      import gsap from "gsap";
      if (!settings.prefersReducedMotion) gsap.to(".a", { x: 1 });
    `;
    expect(rules(code, "a.ts")).not.toContain("require-reduced-motion-guard");
  });
});

describe("pause control detection", () => {
  it("does not treat paused: false as a pause control", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".a", { x: 1, repeat: -1, paused: false });
    `;
    expect(rules(code, "a.ts")).toContain("no-infinite-animation");
  });

  it("treats paused: true as a pause control", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".a", { x: 1, repeat: -1, paused: true });
    `;
    expect(rules(code, "a.ts")).not.toContain("no-infinite-animation");
  });

  it("treats a pause method reference as a pause control", () => {
    const code = `
      import gsap from "gsap";
      const tween = gsap.to(".a", { x: 1, repeat: -1 });
      export const stop = tween.pause;
    `;
    expect(rules(code, "a.ts")).not.toContain("no-infinite-animation");
  });
});

describe("gsap timelines", () => {
  it("follows a timeline held in a local", () => {
    const code = `
      import gsap from "gsap";
      const tl = gsap.timeline();
      tl.to(".layer", { y: -200, duration: 12 });
    `;
    expect(rules(code, "a.ts")).toContain("no-long-animation");
  });

  it("follows a fluent chain off gsap.timeline()", () => {
    const code = `
      import gsap from "gsap";
      gsap.timeline().to(".layer", { y: -200, duration: 12 });
    `;
    expect(rules(code, "a.ts")).toContain("no-long-animation");
  });

  it("follows a timeline reassigned through a second local", () => {
    const code = `
      import gsap from "gsap";
      const first = gsap.timeline();
      const second = first.timeline();
      second.to(".layer", { y: -200, duration: 12 });
    `;
    expect(rules(code, "a.ts")).toContain("no-long-animation");
  });

  it("ignores a to() call on something unrelated", () => {
    const code = `
      import { converter } from "./units";
      converter.to("metres", { duration: 12 });
    `;
    expect(rules(code, "a.ts")).toHaveLength(0);
  });

  it("reads the GSAP 2 duration argument", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".hero", 12, { x: 400 });
    `;
    expect(rules(code, "a.ts")).toContain("no-long-animation");
  });

  it("flags ScrollTrigger.create", () => {
    const code = `
      import ScrollTrigger from "gsap/ScrollTrigger";
      ScrollTrigger.create({ trigger: ".a", scrub: true });
    `;
    expect(rules(code, "a.ts")).toContain("no-scroll-linked-animation");
  });

  it("ignores ScrollTrigger housekeeping calls", () => {
    const code = `
      import ScrollTrigger from "gsap/ScrollTrigger";
      ScrollTrigger.refresh();
    `;
    expect(rules(code, "a.ts")).toHaveLength(0);
  });
});

describe("lottie detection", () => {
  it("ignores a Player component that is not from a lottie package", () => {
    const code = `
      const Player = ({ src }) => <video src={src} />;
      export const V = () => <Player src="a.mp4" />;
    `;
    expect(rules(code)).toHaveLength(0);
  });

  it("recognises Player when it comes from a lottie package", () => {
    const code = `
      import { Player } from "@lottiefiles/react-lottie-player";
      export const V = () => <Player autoplay loop src="a.json" />;
    `;
    expect(rules(code)).toContain("no-autoplay-lottie");
  });

  it("flags lottie-react, which autoplays and loops by default", () => {
    const code = `
      import Lottie from "lottie-react";
      export const Hero = () => <Lottie animationData={data} />;
    `;
    const found = rules(code);
    expect(found).toContain("no-autoplay-lottie");
    expect(found).toContain("no-infinite-animation");
  });

  it("reads a numeric loop as a finite count", () => {
    const code = `
      import Lottie from "lottie-react";
      export const Hero = () => <Lottie animationData={data} loop={3} autoplay={false} />;
    `;
    expect(rules(code)).not.toContain("no-infinite-animation");
  });

  it("stays quiet when autoplay cannot be read statically", () => {
    const code = `
      import Lottie from "lottie-react";
      export const Hero = () => <Lottie animationData={data} autoplay={shouldPlay} loop={false} />;
    `;
    expect(rules(code)).not.toContain("no-autoplay-lottie");
  });

  it("reads lottie-web loop as a count rather than a flag", () => {
    const code = `
      import lottie from "lottie-web";
      lottie.loadAnimation({ container: el, autoplay: true, loop: 2, path: "a.json" });
    `;
    const found = rules(code, "a.ts");
    expect(found).toContain("no-autoplay-lottie");
    expect(found).not.toContain("no-infinite-animation");
  });
});

describe("typescript syntax", () => {
  it("sees through an as-expression on a scroll behavior", () => {
    const code = `el.scrollIntoView({ behavior: "smooth" as ScrollBehavior });`;
    expect(rules(code, "a.ts")).toContain("no-smooth-scroll");
  });

  it("sees through an as-expression on a duration", () => {
    const code = `
      import gsap from "gsap";
      gsap.to(".a", { x: 1, duration: 12 as number });
    `;
    expect(rules(code, "a.ts")).toContain("no-long-animation");
  });

  it("sees through a non-null assertion on a call target", () => {
    const code = `el!.scrollIntoView({ behavior: "smooth" });`;
    expect(rules(code, "a.ts")).toContain("no-smooth-scroll");
  });
});

describe("smooth scroll", () => {
  it("flags scrollBehavior in a style object", () => {
    const code = `export const A = () => <div style={{ scrollBehavior: "smooth" }} />;`;
    expect(rules(code)).toContain("no-smooth-scroll");
  });

  it("ignores a computed key that happens to be named scrollBehavior", () => {
    const code = `const style = { [scrollBehavior]: "smooth" };`;
    expect(rules(code, "a.ts")).toHaveLength(0);
  });
});
