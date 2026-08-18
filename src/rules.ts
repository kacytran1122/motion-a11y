import { Node, getProp, isInfinity, isTrue, jsxAttrValue, numberValue } from "./ast.js";
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
  "visibility",
  "borderColor",
  "boxShadow",
  "fill",
  "stroke",
]);

/** Below this many milliseconds per cycle the animation flashes faster than 3 times a second. */
const FLASH_CYCLE_MS = 333;

/** WCAG 2.2.2 applies to moving content that runs longer than this. */
const LONG_ANIMATION_MS = 5000;

function toMs(value: number, unit: "s" | "ms"): number {
  return unit === "s" ? value * 1000 : value;
}

/** Duration of one cycle in milliseconds, when it can be read statically. */
function durationMs(site: AnimationSite): number | null {
  const fromConfig = numberValue(getProp(site.config, "duration"));
  if (fromConfig !== null) return toMs(fromConfig, site.unit);

  // Web Animations API allows a bare number as the options argument.
  if (site.library === "waapi") {
    const bare = numberValue(site.node.arguments?.[1]);
    if (bare !== null) return bare;
  }

  // framer-motion allows the transition to sit inside the animate object.
  const nested = numberValue(getProp(getProp(site.target, "transition"), "duration"));
  if (nested !== null) return toMs(nested, site.unit);

  return null;
}

/** True when the animation repeats forever. */
function isEndless(site: AnimationSite): boolean {
  const repeat = getProp(site.config, "repeat") ?? getProp(getProp(site.target, "transition"), "repeat");
  if (isInfinity(repeat)) return true;
  if (site.library === "gsap" && numberValue(repeat) === -1) return true;

  const iterations = getProp(site.config, "iterations");
  if (isInfinity(iterations)) return true;

  if (site.library === "lottie") {
    const loop = (site as any).loopValue ?? jsxAttrValue((site as any).loopAttr);
    if (isTrue(loop)) return true;
    // A bare `loop` JSX attribute means true.
    if ((site as any).loopAttr && !(site as any).loopAttr.value) return true;
  }
  return false;
}

/** Names of the properties being animated, when they can be read statically. */
function animatedProps(site: AnimationSite): string[] {
  const names = new Set<string>();

  const readObject = (object: Node) => {
    if (object?.type !== "ObjectExpression") return;
    for (const prop of object.properties) {
      if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
      const key = prop.key?.name ?? prop.key?.value;
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
  return {
    rule,
    message,
    start: site.node.start ?? 0,
    end: site.node.end ?? (site.node.start ?? 0) + 1,
    source: site.library,
    ...extra,
  };
}

export function runRules(context: FileContext): Finding[] {
  const findings: Finding[] = [];
  const { guarded, hasPauseControl, sites } = context;

  const animations = sites.filter((site) => !site.smoothScroll);

  // --- require-reduced-motion-guard -------------------------------------
  // Reported once per file. Repeating it for every call is noise, not signal.
  if (!guarded && animations.length > 0) {
    const first = animations[0]!;
    const count = animations.length;
    findings.push(
      finding(
        first,
        "require-reduced-motion-guard",
        count === 1
          ? `${first.label} animates without a reduced motion guard. Check useReducedMotion or a (prefers-reduced-motion: reduce) media query before animating.`
          : `${count} animations in this file run without a reduced motion guard. First one is ${first.label}. Check useReducedMotion or a (prefers-reduced-motion: reduce) media query before animating.`,
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
    const endless = isEndless(site);
    const props = animatedProps(site);

    // --- no-fast-flash ---------------------------------------------------
    // A reduced motion guard does not silence this one. Users who never set
    // the preference are still exposed to the seizure risk.
    if (endless && cycleMs !== null && cycleMs > 0 && cycleMs < FLASH_CYCLE_MS) {
      const flashy = props.filter((name) => FLASHY_PROPS.has(name));
      if (flashy.length > 0) {
        const perSecond = (1000 / cycleMs).toFixed(1);
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
    if (
      cycleMs !== null &&
      cycleMs > LONG_ANIMATION_MS &&
      !guarded &&
      !hasPauseControl
    ) {
      const seconds = (cycleMs / 1000).toFixed(1);
      findings.push(
        finding(
          site,
          "no-long-animation",
          `${site.label} runs for ${seconds}s. Moving content over 5s needs a pause, stop or hide control.`,
          { wcag: "2.2.2 Pause, Stop, Hide" },
        ),
      );
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
    if (site.library === "lottie" && !guarded) {
      const autoplayValue = (site as any).autoplayValue;
      const autoplayAttr = (site as any).autoplayAttr;
      const explicitAutoplay =
        isTrue(autoplayValue) || (autoplayAttr && (!autoplayAttr.value || isTrue(jsxAttrValue(autoplayAttr))));
      if (explicitAutoplay) {
        findings.push(
          finding(
            site,
            "no-autoplay-lottie",
            `${site.label} plays on load with no reduced motion guard. Give the user a way to start it, or skip the animation when motion is reduced.`,
            { wcag: "2.2.2 Pause, Stop, Hide" },
          ),
        );
      }
    }
  }

  return findings;
}
