import {
  Node,
  calleeName as readCalleeName,
  getJsxAttr,
  getProp,
  getPropPath,
  jsxAttrValue,
  memberPath,
  stringValue,
  tail,
  walk,
} from "./ast.js";

export type Library = "motion" | "gsap" | "lottie" | "waapi" | "dom";

export interface AnimationSite {
  library: Library;
  /** Human readable label for the call or element, for example `gsap.to`. */
  label: string;
  /** Node to report on. */
  node: Node;
  /** Object holding timing options, when one is present. */
  config: Node | null;
  /** Object or array holding the animated properties, when one is present. */
  target: Node | null;
  /** Unit used by this library for `duration`. */
  unit: "s" | "ms";
  /** True when the site is driven by scroll position. */
  scrollLinked?: boolean;
  /** True when the site is a smooth scroll request rather than an animation. */
  smoothScroll?: boolean;
}

export interface FileContext {
  /** local name -> module it was imported from */
  imports: Map<string, string>;
  /** True when the file contains a reduced motion guard. */
  guarded: boolean;
  /** True when the file appears to expose a pause or stop control. */
  hasPauseControl: boolean;
  sites: AnimationSite[];
}

const MOTION_MODULES = /^(framer-motion|motion)(\/|$)/;
const GSAP_MODULES = /^gsap(\/|$)/;
const LOTTIE_MODULES = /lottie/i;

const GUARD_IDENTIFIERS = new Set([
  "useReducedMotion",
  "usePrefersReducedMotion",
  "prefersReducedMotion",
  "shouldReduceMotion",
  "reducedMotion",
  "reduceMotion",
  "isReducedMotion",
  "useMotionPreference",
]);

const LOTTIE_COMPONENTS = new Set([
  "Lottie",
  "Player",
  "DotLottieReact",
  "DotLottiePlayer",
  "LottiePlayer",
  "LottieView",
]);

const MOTION_TIMING_PROPS = ["animate", "whileHover", "whileTap", "whileInView", "whileDrag"];

const SCROLL_HOOKS = new Set([
  "useScroll",
  "useElementScroll",
  "useViewportScroll",
  "useScrollYProgress",
  "ScrollTrigger",
]);

const SMOOTH_SCROLL_METHODS = new Set(["scrollTo", "scrollIntoView", "scrollBy", "scroll"]);

function isPauseToken(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "pause" ||
    lower === "paused" ||
    lower === "stop" ||
    lower === "stopped" ||
    lower.includes("pause") ||
    lower.startsWith("toggleplay") ||
    lower === "setplaying" ||
    lower === "isplaying"
  );
}

/** Last object argument of a call, which is where every one of these libraries puts options. */
function lastObjectArg(args: Node[]): Node | null {
  for (let i = args.length - 1; i >= 0; i--) {
    if (args[i]?.type === "ObjectExpression") return args[i];
  }
  return null;
}

export function collect(ast: Node): FileContext {
  const imports = new Map<string, string>();
  const sites: AnimationSite[] = [];
  let guarded = false;
  let hasPauseControl = false;

  // Pass one: imports only, so later passes can resolve local names.
  walk(ast, (node) => {
    if (node.type !== "ImportDeclaration") return;
    const source = node.source?.value;
    if (typeof source !== "string") return;
    for (const spec of node.specifiers ?? []) {
      const local = spec.local?.name;
      if (local) imports.set(local, source);
    }
  });

  const moduleOf = (name: string | null): string | undefined =>
    name ? imports.get(name) : undefined;

  const rootOf = (path: string | null): string | null => (path ? path.split(".")[0]! : null);

  const isMotionName = (path: string | null): boolean => {
    const root = rootOf(path);
    if (!root) return false;
    const mod = moduleOf(root);
    if (mod && MOTION_MODULES.test(mod)) return true;
    return root === "motion" && !mod;
  };

  const isGsapName = (path: string | null): boolean => {
    const root = rootOf(path);
    if (!root) return false;
    const mod = moduleOf(root);
    if (mod && GSAP_MODULES.test(mod)) return true;
    return root === "gsap" && !mod;
  };

  const isLottieName = (name: string | null): boolean => {
    if (!name) return false;
    const mod = moduleOf(name);
    if (mod && LOTTIE_MODULES.test(mod)) return true;
    return LOTTIE_COMPONENTS.has(name) && !mod;
  };

  // Pass two: guards, pause controls and animation sites.
  walk(ast, (node) => {
    // ---- guard detection, from real tokens rather than raw text ----
    if (node.type === "Identifier" && GUARD_IDENTIFIERS.has(node.name)) guarded = true;
    if (node.type === "JSXAttribute" && node.name?.name === "reducedMotion") guarded = true;
    if (node.type === "StringLiteral" || node.type === "TemplateLiteral") {
      const value = stringValue(node);
      if (value && value.includes("prefers-reduced-motion")) guarded = true;
    }

    // ---- pause control detection ----
    if (node.type === "Identifier" && isPauseToken(node.name)) hasPauseControl = true;
    if (node.type === "CallExpression") {
      const name = readCalleeName(node.callee);
      if (name && isPauseToken(name)) hasPauseControl = true;
    }

    // ---- JSX sites ----
    if (node.type === "JSXElement") {
      const name = memberPath(node.openingElement?.name);
      const root = rootOf(name);

      // framer-motion / motion: <motion.div animate={...} transition={...} />
      if (name && isMotionName(name) && name.includes(".")) {
        const transitionAttr = getJsxAttr(node, "transition");
        let config = jsxAttrValue(transitionAttr);
        let target: Node | null = null;
        for (const prop of MOTION_TIMING_PROPS) {
          const attr = getJsxAttr(node, prop);
          if (!attr) continue;
          const value = jsxAttrValue(attr);
          if (!target) target = value;
          if (!config) config = getProp(value, "transition");
        }
        const hasLayout = !!(getJsxAttr(node, "layout") || getJsxAttr(node, "layoutId"));
        if (target || config || hasLayout) {
          sites.push({
            library: "motion",
            label: `<${name}>`,
            node: node.openingElement ?? node,
            config,
            target,
            unit: "s",
          });
        }
      }

      // Lottie players
      if (root && isLottieName(root)) {
        const autoplay = getJsxAttr(node, "autoplay") ?? getJsxAttr(node, "autoPlay");
        const loop = getJsxAttr(node, "loop");
        sites.push({
          library: "lottie",
          label: `<${name}>`,
          node: node.openingElement ?? node,
          config: null,
          target: null,
          unit: "ms",
          ...(autoplay || loop ? {} : {}),
        });
        // Store the two attributes on the site for the autoplay rule.
        const site = sites[sites.length - 1]!;
        (site as any).autoplayAttr = autoplay;
        (site as any).loopAttr = loop;
      }
      return;
    }

    if (node.type !== "CallExpression") return;

    const calleePath = memberPath(node.callee);
    const calleeName = readCalleeName(node.callee) ?? tail(calleePath);
    const args: Node[] = node.arguments ?? [];

    // ---- scroll linked hooks ----
    if (calleeName && SCROLL_HOOKS.has(calleeName)) {
      sites.push({
        library: isGsapName(calleePath) ? "gsap" : "motion",
        label: calleePath ?? calleeName,
        node,
        config: lastObjectArg(args),
        target: null,
        unit: "s",
        scrollLinked: true,
      });
      return;
    }

    // ---- smooth scroll requests ----
    if (calleeName && SMOOTH_SCROLL_METHODS.has(calleeName)) {
      const options = lastObjectArg(args);
      if (options && stringValue(getProp(options, "behavior")) === "smooth") {
        sites.push({
          library: "dom",
          label: calleePath ?? calleeName,
          node,
          config: options,
          target: null,
          unit: "ms",
          smoothScroll: true,
        });
        return;
      }
    }

    // ---- gsap ----
    if (isGsapName(calleePath) && calleeName && calleeName !== "registerPlugin") {
      if (["to", "from", "fromTo", "timeline", "set"].includes(calleeName)) {
        const vars = lastObjectArg(args);
        const scrollLinked = !!getProp(vars, "scrollTrigger");
        if (calleeName === "set" && !scrollLinked) return; // `set` is instant
        sites.push({
          library: "gsap",
          label: calleePath ?? calleeName,
          node,
          config: vars,
          target: vars,
          unit: "s",
          scrollLinked,
        });
        return;
      }
    }

    // ---- motion: animate(), scroll(), spring() ----
    if (isMotionName(calleePath) && calleeName) {
      if (["animate", "scroll", "inView", "spring"].includes(calleeName)) {
        sites.push({
          library: "motion",
          label: calleePath ?? calleeName,
          node,
          config: lastObjectArg(args),
          target: args[1] ?? null,
          unit: "s",
          scrollLinked: calleeName === "scroll",
        });
        return;
      }
    }

    // ---- lottie-web loadAnimation ----
    if (calleeName === "loadAnimation") {
      const config = lastObjectArg(args);
      const site: AnimationSite = {
        library: "lottie",
        label: calleePath ?? calleeName,
        node,
        config,
        target: null,
        unit: "ms",
      };
      (site as any).autoplayValue = getProp(config, "autoplay");
      (site as any).loopValue = getProp(config, "loop");
      sites.push(site);
      return;
    }

    // ---- Web Animations API: element.animate(keyframes, options) ----
    if (
      calleeName === "animate" &&
      node.callee?.type === "MemberExpression" &&
      !isMotionName(calleePath) &&
      !isGsapName(calleePath)
    ) {
      const keyframes = args[0] ?? null;
      const options = args[1] ?? null;
      sites.push({
        library: "waapi",
        label: `${calleePath ?? "element.animate"}`,
        node,
        config: options?.type === "ObjectExpression" ? options : null,
        target: keyframes,
        unit: "ms",
      });
      return;
    }

    // ---- scroll-behavior set from JS ----
    void getPropPath;
  });

  // Assignments such as `document.documentElement.style.scrollBehavior = "smooth"`.
  walk(ast, (node) => {
    if (node.type !== "AssignmentExpression") return;
    const path = memberPath(node.left);
    if (!path || tail(path) !== "scrollBehavior") return;
    if (stringValue(node.right) !== "smooth") return;
    sites.push({
      library: "dom",
      label: path,
      node,
      config: null,
      target: null,
      unit: "ms",
      smoothScroll: true,
    });
  });

  return { imports, guarded, hasPauseControl, sites };
}
