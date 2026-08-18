import {
  Node,
  booleanValue,
  calleeName as readCalleeName,
  unwrap,
  getJsxAttr,
  getProp,
  head,
  isCallNode,
  isMemberNode,
  jsxAttrValue,
  memberPath,
  propertyName,
  stringValue,
  tail,
  walk,
} from "./ast.js";

export type Library = "motion" | "gsap" | "lottie" | "waapi" | "dom";

/** Tri-state: `null` means the value could not be read statically. */
export type Tri = boolean | null;

export interface LottieInfo {
  autoplay: Tri;
  loop: Tri;
  /** True when autoplay/loop came from the library default rather than the code. */
  implicit: boolean;
}

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
  /**
   * Duration expression for the call forms that take a bare value rather than
   * an options object, such as `el.animate(frames, 300)` and `gsap.to(el, 2, {})`.
   */
  durationNode?: Node | null;
  /** Present only for Lottie players. */
  lottie?: LottieInfo;
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
/** Players from these modules start playing and looping unless told otherwise. */
const LOTTIE_AUTOPLAY_BY_DEFAULT = /^(lottie-react|react-lottie)(\/|$)/;

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

/**
 * Component names that mean Lottie on their own. Anything ambiguous, such as
 * `Player`, is only treated as Lottie when it is imported from a Lottie module.
 */
const LOTTIE_COMPONENTS = new Set([
  "Lottie",
  "DotLottieReact",
  "DotLottiePlayer",
  "LottiePlayer",
  "LottieView",
  "LottieAnimation",
]);
const AMBIGUOUS_LOTTIE_COMPONENTS = new Set(["Player", "Animation"]);

const MOTION_TIMING_PROPS = [
  "animate",
  "whileHover",
  "whileTap",
  "whileInView",
  "whileDrag",
  "whileFocus",
  "exit",
];

const SCROLL_HOOKS = new Set([
  "useScroll",
  "useElementScroll",
  "useViewportScroll",
  "useScrollYProgress",
]);

const SMOOTH_SCROLL_METHODS = new Set(["scrollTo", "scrollIntoView", "scrollBy", "scroll"]);

/** Tween and timeline factories that GSAP exposes on both `gsap` and timelines. */
const GSAP_TWEEN_METHODS = new Set(["to", "from", "fromTo", "timeline", "set"]);

/** GSAP plugin entry points that create scroll driven motion. */
const GSAP_SCROLL_PLUGINS = new Set(["ScrollTrigger", "ScrollSmoother"]);

/**
 * A cheap substring test that is a strict superset of everything `collect` can
 * detect. Files that fail it cannot produce a finding, so they never need to be
 * parsed. Most files in a real repository do not animate, and parsing is by far
 * the most expensive step, so this is where the time goes.
 *
 * Every detection path requires one of these markers to appear in the source:
 * `motion` (framer-motion, motion, MotionConfig, every guard identifier, and
 * `prefers-reduced-motion`), `gsap`, `lottie`, `animat` (animate, animation,
 * loadAnimation) or `scroll` (scroll hooks, ScrollTrigger, scrollIntoView,
 * scrollBehavior).
 */
const ANIMATION_MARKERS = /motion|gsap|lottie|animat|scroll/i;

export function mightAnimate(code: string): boolean {
  return ANIMATION_MARKERS.test(code);
}

function isPauseToken(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("pause") ||
    lower === "stop" ||
    lower === "stopped" ||
    lower.startsWith("toggleplay") ||
    lower === "setplaying" ||
    lower === "isplaying"
  );
}

/** Reads one Lottie JSX attribute, falling back to the component's own default. */
function readLottieAttr(attr: Node, fallback: Tri): Tri {
  if (!attr) return fallback;
  if (!attr.value) return true; // bare attribute means true
  const value = jsxAttrValue(attr);
  // `loop={3}` is a repeat count, not an endless loop.
  if (value?.type === "NumericLiteral") return false;
  return booleanValue(value);
}

/** Last object argument of a call, which is where every one of these libraries puts options. */
function lastObjectArg(args: Node[]): Node | null {
  for (let i = args.length - 1; i >= 0; i--) {
    // `gsap.to(".a", { duration: 12 } satisfies Vars)` still holds the options.
    const arg = unwrap(args[i]);
    if (arg?.type === "ObjectExpression") return arg;
  }
  return null;
}

/**
 * True when a node sits in a position where its name is a label rather than a
 * value being read. Property *keys* are handled separately so that
 * `{ reducedMotion: false }` can be told apart from `{ reducedMotion: true }`,
 * but reading `settings.prefersReducedMotion` is a genuine guard and is not
 * excluded here.
 */
function isNamePosition(node: Node, parent: Node | null): boolean {
  if (!parent) return false;
  switch (parent.type) {
    case "ObjectProperty":
    case "Property":
    case "ObjectMethod":
    case "ClassProperty":
    case "ClassMethod":
      return parent.key === node && !parent.computed;
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ExportSpecifier":
      return true;
    default:
      return false;
  }
}

/** `false`, `"never"` and `"off"` all mean the feature is switched off. */
function isDisabledValue(node: Node): boolean {
  const text = stringValue(node);
  if (text !== null) return text === "never" || text === "off" || text === "false";
  return booleanValue(node) === false;
}

export function collect(ast: Node): FileContext {
  const imports = new Map<string, string>();
  const sites: AnimationSite[] = [];
  let guarded = false;
  let hasPauseControl = false;

  // Imports are only legal at the top level, so there is no reason to walk the
  // whole tree looking for them.
  for (const statement of ast?.program?.body ?? []) {
    if (statement?.type !== "ImportDeclaration") continue;
    const source = statement.source?.value;
    if (typeof source !== "string") continue;
    for (const spec of statement.specifiers ?? []) {
      const local = spec.local?.name;
      if (local) imports.set(local, source);
    }
  }

  const moduleOf = (name: string | null): string | undefined =>
    name ? imports.get(name) : undefined;

  const isMotionName = (path: string | null): boolean => {
    const root = head(path);
    if (!root) return false;
    const mod = moduleOf(root);
    if (mod) return MOTION_MODULES.test(mod);
    return root === "motion";
  };

  const isGsapName = (path: string | null): boolean => {
    const root = head(path);
    if (!root) return false;
    const mod = moduleOf(root);
    if (mod) return GSAP_MODULES.test(mod);
    return root === "gsap";
  };

  const lottieModuleOf = (name: string | null): string | null => {
    if (!name) return null;
    const mod = moduleOf(name);
    if (mod) return LOTTIE_MODULES.test(mod) ? mod : null;
    if (LOTTIE_COMPONENTS.has(name)) return "";
    return null;
  };

  /**
   * GSAP timelines are held in locals and animated through them
   * (`const tl = gsap.timeline(); tl.to(...)`). Calls whose receiver is not
   * statically GSAP are parked here and resolved once the whole file is walked,
   * because a local can be used before its declarator has been visited.
   */
  const gsapLocals = new Set<string>();
  const gsapNodes = new Set<Node>();
  interface Pending {
    node: Node;
    method: string;
    rootName: string | null;
    receiver: Node;
    args: Node[];
  }
  const pending: Pending[] = [];
  /** Call node -> the local it was assigned to, so chains propagate. */
  const declaredFrom = new Map<Node, string>();

  const pushGsapSite = (node: Node, label: string, method: string, args: Node[]): void => {
    const vars = lastObjectArg(args);
    const scrollLinked = !!getProp(vars, "scrollTrigger");
    if (method === "set" && !scrollLinked) return; // `set` is instant
    gsapNodes.add(node);
    sites.push({
      library: "gsap",
      label,
      node,
      config: vars,
      target: vars,
      unit: "s",
      scrollLinked,
      // GSAP 2 style: gsap.to(target, duration, vars)
      durationNode: args.length >= 3 && args[1]?.type === "NumericLiteral" ? args[1] : null,
    });
  };

  const readLottieJsx = (element: Node, mod: string): LottieInfo => {
    const autoplayAttr = getJsxAttr(element, "autoplay") ?? getJsxAttr(element, "autoPlay");
    const loopAttr = getJsxAttr(element, "loop");
    const defaultsOn = LOTTIE_AUTOPLAY_BY_DEFAULT.test(mod);
    return {
      autoplay: readLottieAttr(autoplayAttr, defaultsOn),
      loop: readLottieAttr(loopAttr, defaultsOn),
      implicit: defaultsOn && !autoplayAttr,
    };
  };

  walk(ast, (node, parent) => {
    const type = node.type;

    // Import declarations hold names but no behaviour. Skipping the subtree
    // stops `import { useReducedMotion }` from counting as a guard on its own.
    if (
      type === "ImportDeclaration" ||
      type === "TSTypeAliasDeclaration" ||
      type === "TSInterfaceDeclaration"
    ) {
      return false;
    }

    // ---- guard detection, from real tokens rather than raw text ----
    if (!guarded) {
      if (
        type === "Identifier" &&
        GUARD_IDENTIFIERS.has(node.name) &&
        !isNamePosition(node, parent)
      ) {
        guarded = true;
      } else if (type === "JSXAttribute" && node.name?.name === "reducedMotion") {
        // <MotionConfig reducedMotion="never"> switches the guard off.
        if (!isDisabledValue(jsxAttrValue(node))) guarded = true;
      } else if (
        (type === "ObjectProperty" || type === "Property") &&
        GUARD_IDENTIFIERS.has(propertyName(node) ?? "") &&
        !isDisabledValue(node.value)
      ) {
        guarded = true;
      } else if (type === "StringLiteral" || type === "TemplateLiteral") {
        const value = stringValue(node);
        if (value !== null && value.includes("prefers-reduced-motion")) guarded = true;
      }
    }

    // ---- pause control detection ----
    if (!hasPauseControl) {
      if (type === "Identifier" && isPauseToken(node.name)) {
        // `{ paused: false }` is the opposite of a pause control.
        const isKey =
          (parent?.type === "ObjectProperty" || parent?.type === "Property") &&
          parent.key === node &&
          !parent.computed;
        if (!isKey || booleanValue(parent.value) !== false) hasPauseControl = true;
      } else if (type === "CallExpression") {
        const name = readCalleeName(node.callee);
        if (name && isPauseToken(name)) hasPauseControl = true;
      }
    }

    // ---- JSX sites ----
    if (type === "JSXElement") {
      const name = memberPath(node.openingElement?.name);
      const root = head(name);

      // framer-motion / motion: <motion.div animate={...} transition={...} />
      if (name && name.includes(".") && isMotionName(name)) {
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

      // Lottie players. An ambiguous name such as `Player` only counts when it
      // was actually imported from a Lottie package.
      if (root) {
        const mod = lottieModuleOf(root);
        const known = mod !== null && (mod !== "" || !AMBIGUOUS_LOTTIE_COMPONENTS.has(root));
        if (known) {
          sites.push({
            library: "lottie",
            label: `<${name}>`,
            node: node.openingElement ?? node,
            config: null,
            target: null,
            unit: "ms",
            lottie: readLottieJsx(node, mod),
          });
        }
      }
      return;
    }

    if (type === "ObjectProperty" || type === "Property") {
      // style={{ scrollBehavior: "smooth" }}
      if (propertyName(node) === "scrollBehavior" && stringValue(node.value) === "smooth") {
        sites.push({
          library: "dom",
          label: "scrollBehavior",
          node,
          config: null,
          target: null,
          unit: "ms",
          smoothScroll: true,
        });
      }
      return;
    }

    if (type === "VariableDeclarator" || type === "AssignmentExpression") {
      // const tl = gsap.timeline(...)  /  tl = gsap.timeline(...)
      const init = unwrap(type === "VariableDeclarator" ? node.init : node.right);
      const binding = type === "VariableDeclarator" ? node.id : node.left;
      if (type === "AssignmentExpression") {
        // document.documentElement.style.scrollBehavior = "smooth"
        const path = memberPath(node.left);
        if (path && tail(path) === "scrollBehavior" && stringValue(node.right) === "smooth") {
          sites.push({
            library: "dom",
            label: path,
            node,
            config: null,
            target: null,
            unit: "ms",
            smoothScroll: true,
          });
          return;
        }
      }
      if (isCallNode(init) && binding?.type === "Identifier") {
        const method = readCalleeName(init.callee);
        if (method && GSAP_TWEEN_METHODS.has(method)) {
          if (isGsapName(memberPath(init.callee))) gsapLocals.add(binding.name);
          else declaredFrom.set(init, binding.name);
        }
      }
      return;
    }

    if (!isCallNode(node)) return;

    const calleePath = memberPath(node.callee);
    const calleeName = readCalleeName(node.callee) ?? tail(calleePath);
    const args: Node[] = node.arguments ?? [];

    // ---- scroll linked hooks and ScrollTrigger ----
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

    // ScrollTrigger.create({...}) and ScrollSmoother.create({...})
    const calleeRoot = head(calleePath);
    if (calleeName === "create" && calleeRoot && GSAP_SCROLL_PLUGINS.has(calleeRoot)) {
      sites.push({
        library: "gsap",
        label: calleePath ?? calleeRoot,
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
    if (calleeName && GSAP_TWEEN_METHODS.has(calleeName)) {
      if (isGsapName(calleePath)) {
        pushGsapSite(node, calleePath ?? calleeName, calleeName, args);
        return;
      }
      const receiver = isMemberNode(node.callee) ? unwrap(node.callee.object) : null;
      if (receiver) {
        pending.push({ node, method: calleeName, rootName: head(calleePath), receiver, args });
      }
    }

    // ---- motion: animate() and scroll() ----
    if (isMotionName(calleePath) && calleeName) {
      if (calleeName === "animate" || calleeName === "scroll") {
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
      const loop = getProp(config, "loop");
      sites.push({
        library: "lottie",
        label: calleePath ?? calleeName,
        node,
        config,
        target: null,
        unit: "ms",
        // lottie-web defaults both to false, so absence means off.
        lottie: {
          autoplay: config ? (booleanValue(getProp(config, "autoplay")) ?? false) : false,
          // `loop: 3` is a count, not an endless loop.
          loop: loop && loop.type === "NumericLiteral" ? false : (booleanValue(loop) ?? false),
          implicit: false,
        },
      });
      return;
    }

    // ---- Web Animations API: element.animate(keyframes, options) ----
    if (
      calleeName === "animate" &&
      isMemberNode(node.callee) &&
      !isMotionName(calleePath) &&
      !isGsapName(calleePath)
    ) {
      const keyframes = args[0] ?? null;
      const options = args[1] ?? null;
      sites.push({
        library: "waapi",
        label: calleePath ?? "element.animate",
        node,
        config: unwrap(options)?.type === "ObjectExpression" ? unwrap(options) : null,
        target: keyframes,
        unit: "ms",
        durationNode: unwrap(options)?.type === "ObjectExpression" ? null : options,
      });
    }
  });

  resolvePendingGsap(pending, gsapLocals, gsapNodes, declaredFrom, pushGsapSite);

  // Report in source order regardless of the order the tree was walked in.
  sites.sort((a, b) => (a.node.start ?? 0) - (b.node.start ?? 0));

  return { imports, guarded, hasPauseControl, sites };
}

/** Appends to a list held in a map, creating the list on first use. */
function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/**
 * Promotes calls such as `tl.to(...)` and `gsap.timeline().to(...)` to GSAP
 * sites.
 *
 * This is a worklist rather than a repeated sweep: pending calls are indexed by
 * what they are waiting on, so resolving one receiver only touches the calls
 * that were actually waiting for it. That keeps a long fluent chain linear
 * instead of quadratic, and removes the need for a round limit that would
 * silently leave the tail of a long chain unchecked.
 */
function resolvePendingGsap(
  pending: Array<{
    node: Node;
    method: string;
    rootName: string | null;
    receiver: Node;
    args: Node[];
  }>,
  gsapLocals: Set<string>,
  gsapNodes: Set<Node>,
  declaredFrom: Map<Node, string>,
  push: (node: Node, label: string, method: string, args: Node[]) => void,
): void {
  if (pending.length === 0) return;

  type Item = (typeof pending)[number];
  const waitingOnNode = new Map<Node, Item[]>();
  const waitingOnLocal = new Map<string, Item[]>();

  for (const item of pending) {
    if (item.receiver.type === "Identifier") pushInto(waitingOnLocal, item.receiver.name, item);
    else if (isCallNode(item.receiver)) pushInto(waitingOnNode, item.receiver, item);
  }

  const nodeQueue: Node[] = [...gsapNodes];
  const localQueue: string[] = [...gsapLocals];

  const release = (item: Item): void => {
    if (gsapNodes.has(item.node)) return; // already resolved through another path
    push(
      item.node,
      item.rootName ? `${item.rootName}.${item.method}` : item.method,
      item.method,
      item.args,
    );
    gsapNodes.add(item.node);
    nodeQueue.push(item.node);
    const local = declaredFrom.get(item.node);
    if (local && !gsapLocals.has(local)) {
      gsapLocals.add(local);
      localQueue.push(local);
    }
  };

  while (nodeQueue.length > 0 || localQueue.length > 0) {
    const node = nodeQueue.pop();
    if (node !== undefined) {
      const waiting = waitingOnNode.get(node);
      if (waiting) {
        waitingOnNode.delete(node);
        for (const item of waiting) release(item);
      }
      continue;
    }
    const local = localQueue.pop()!;
    const waiting = waitingOnLocal.get(local);
    if (waiting) {
      waitingOnLocal.delete(local);
      for (const item of waiting) release(item);
    }
  }
}
