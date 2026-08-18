import {
  Node,
  booleanValue,
  getProp,
  isInfinity,
  numberValue,
  spanOf,
  stringValue,
} from "./ast.js";
import type { AnimationSite, FileContext } from "./collect.js";
import type { Finding } from "./types.js";

/** Properties whose rapid change reads as a flash. */
const FLASHY_PROPS = new Set([
  "opacity",
  "background",
  "backgroundColor",
  "backgroundImage",
  "color",
  "filter",
  "backdropFilter",
  "visibility",
  "borderColor",
  "boxShadow",
  "textShadow",
  "fill",
  "stroke",
]);

/** Below this many milliseconds per cycle the animation flashes faster than 3 times a second. */
const FLASH_CYCLE_MS = 333;

/** WCAG 2.3.1 is about three flashes within any one second window. */
const FLASH_COUNT_THRESHOLD = 3;

/** WCAG 2.2.2 applies to moving content that runs longer than this. */
const LONG_ANIMATION_MS = 5000;

function toMs(value: number, unit: "s" | "ms"): number {
  return unit === "s" ? value * 1000 : value;
}

/** Reads a transition option from wherever the library allows it to be written. */
function option(site: AnimationSite, name: string): Node | null {
  return (
    getProp(site.config, name) ??
    getProp(getProp(site.target, "transition"), name) ??
    getProp(getProp(site.config, "transition"), name)
  );
}

/** Duration of one cycle in milliseconds, when it can be read statically. */
function durationMs(site: AnimationSite): number | null {
  const explicit = numberValue(option(site, "duration"));
  if (explicit !== null && explicit >= 0) return toMs(explicit, site.unit);

  // Call forms that take a bare duration: el.animate(frames, 300), gsap.to(el, 2, {}).
  const bare = numberValue(site.durationNode);
  if (bare !== null && bare >= 0) return toMs(bare, site.unit);

  return null;
}

/**
 * How many times the animation plays, counting the first pass.
 * `Infinity` for endless, `null` when it cannot be read statically.
 */
function cycleCount(site: AnimationSite): number | null {
  if (site.library === "lottie") {
    return site.lottie?.loop === true ? Number.POSITIVE_INFINITY : 1;
  }

  // Web Animations API: `iterations` is the total count.
  const iterations = getProp(site.config, "iterations");
  if (iterations) {
    if (isInfinity(iterations)) return Number.POSITIVE_INFINITY;
    const value = numberValue(iterations);
    if (value !== null) return value;
    return null;
  }

  // framer-motion, motion and GSAP: `repeat` counts the *extra* passes.
  const repeat = option(site, "repeat");
  if (repeat) {
    if (isInfinity(repeat)) return Number.POSITIVE_INFINITY;
    const value = numberValue(repeat);
    if (value === null) return null;
    if (value < 0) return Number.POSITIVE_INFINITY; // GSAP uses -1 for endless
    return value + 1;
  }

  return 1;
}

/** True when the animation reverses on each pass, which halves the flash rate. */
function reverses(site: AnimationSite): boolean {
  if (booleanValue(option(site, "yoyo")) === true) return true;
  const repeatType = stringValue(option(site, "repeatType"));
  if (repeatType === "reverse" || repeatType === "mirror") return true;
  const direction = stringValue(getProp(site.config, "direction"));
  return direction === "alternate" || direction === "alternate-reverse";
}

/** Names of the properties being animated, when they can be read statically. */
function animatedProps(site: AnimationSite): string[] {
  const names = new Set<string>();

  const readObject = (object: Node) => {
    if (object?.type !== "ObjectExpression") return;
    for (const prop of object.properties) {
      if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
      const key = prop.computed ? null : (prop.key?.name ?? prop.key?.value);
      if (typeof key === "string") names.add(key);
    }
  };

  const target = site.target;
  if (target?.type === "ArrayExpression") {
    for (const item of target.elements) readObject(item);
  } else {
    readObject(target);
  }
  return [...names];
}

function finding(
  site: AnimationSite,
  rule: Finding["rule"],
  message: string,
  extra: Partial<Finding> = {},
): Finding {
  const span = spanOf(site.node);
  return {
    rule,
    message,
    start: span?.start ?? site.node.start ?? 0,
    end: span?.end ?? site.node.end ?? 0,
    span,
    source: site.library,
    ...extra,
  };
}

export function runRules(context: FileContext): Finding[] {
  const findings: Finding[] = [];
  const { guarded, hasPauseControl, sites } = context;

  let firstAnimation: AnimationSite | null = null;
  let animationCount = 0;
  for (const site of sites) {
    if (site.smoothScroll) continue;
    animationCount++;
    if (!firstAnimation) firstAnimation = site;
  }

  // --- require-reduced-motion-guard -------------------------------------
  // Reported once per file. Repeating it for every call is noise, not signal.
  if (!guarded && firstAnimation) {
    findings.push(
      finding(
        firstAnimation,
        "require-reduced-motion-guard",
        animationCount === 1
          ? `${firstAnimation.label} animates without a reduced motion guard. Check useReducedMotion or a (prefers-reduced-motion: reduce) media query before animating.`
          : `${animationCount} animations in this file run without a reduced motion guard. First one is ${firstAnimation.label}. Check useReducedMotion or a (prefers-reduced-motion: reduce) media query before animating.`,
        { wcag: "2.3.3 Animation from Interactions" },
      ),
    );
  }

  for (const site of sites) {
    // --- no-smooth-scroll ------------------------------------------------
    if (site.smoothScroll) {
      if (!guarded) {
        findings.push(
          finding(
            site,
            "no-smooth-scroll",
            `${site.label} requests smooth scrolling with no reduced motion fallback. Smooth scroll is a common vestibular trigger.`,
            { wcag: "2.3.3 Animation from Interactions" },
          ),
        );
      }
      continue;
    }

    const cycleMs = durationMs(site);
    const cycles = cycleCount(site);
    const endless = cycles === Number.POSITIVE_INFINITY;

    // --- no-fast-flash ---------------------------------------------------
    // A reduced motion guard does not silence this one. Users who never set
    // the preference are still exposed to the seizure risk.
    // A reversing repeat plays light -> dark -> light per two passes, so the
    // period of one full flash is twice the declared duration.
    const flashPeriodMs = cycleMs === null ? null : cycleMs * (reverses(site) ? 2 : 1);
    const flashes = cycles === null ? null : reverses(site) ? cycles / 2 : cycles;
    if (
      flashPeriodMs !== null &&
      flashPeriodMs > 0 &&
      flashPeriodMs < FLASH_CYCLE_MS &&
      flashes !== null &&
      flashes >= FLASH_COUNT_THRESHOLD
    ) {
      const flashy = animatedProps(site).filter((name) => FLASHY_PROPS.has(name));
      if (flashy.length > 0) {
        const perSecond = (1000 / flashPeriodMs).toFixed(1);
        findings.push(
          finding(
            site,
            "no-fast-flash",
            `${site.label} repeats ${flashy.join(", ")} about ${perSecond} times a second. Anything over 3 flashes a second is a seizure risk.`,
            { wcag: "2.3.1 Three Flashes or Below Threshold", unsuppressable: true },
          ),
        );
      }
    }

    // --- no-infinite-animation -------------------------------------------
    if (endless && !guarded && !hasPauseControl) {
      findings.push(
        finding(
          site,
          "no-infinite-animation",
          `${site.label} repeats forever with no pause control and no reduced motion guard.`,
          { wcag: "2.2.2 Pause, Stop, Hide" },
        ),
      );
    }

    // --- no-long-animation ------------------------------------------------
    // Total run time, not one pass: `duration: 2, repeat: 5` is twelve seconds
    // of movement. Endless animations are left to no-infinite-animation.
    if (!endless && cycleMs !== null && cycles !== null && !guarded && !hasPauseControl) {
      const totalMs = cycleMs * cycles;
      if (totalMs > LONG_ANIMATION_MS) {
        const seconds = (totalMs / 1000).toFixed(1);
        const detail = cycles > 1 ? ` (${cycles} passes of ${(cycleMs / 1000).toFixed(1)}s)` : "";
        findings.push(
          finding(
            site,
            "no-long-animation",
            `${site.label} runs for ${seconds}s${detail}. Moving content over 5s needs a pause, stop or hide control.`,
            { wcag: "2.2.2 Pause, Stop, Hide" },
          ),
        );
      }
    }

    // --- no-scroll-linked-animation ---------------------------------------
    if (site.scrollLinked && !guarded) {
      findings.push(
        finding(
          site,
          "no-scroll-linked-animation",
          `${site.label} ties motion to scroll position with no reduced motion guard. Scroll linked movement is the strongest vestibular trigger on the web.`,
          { wcag: "2.3.3 Animation from Interactions" },
        ),
      );
    }

    // --- no-autoplay-lottie ------------------------------------------------
    if (site.lottie && !guarded && site.lottie.autoplay === true) {
      const because = site.lottie.implicit
        ? " This player autoplays by default, so leaving `autoplay` off does not stop it."
        : "";
      findings.push(
        finding(
          site,
          "no-autoplay-lottie",
          `${site.label} plays on load with no reduced motion guard.${because} Give the user a way to start it, or skip the animation when motion is reduced.`,
          { wcag: "2.2.2 Pause, Stop, Hide" },
        ),
      );
    }
  }

  return findings;
}
