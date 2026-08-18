import { parse, type ParserOptions, type ParserPlugin } from "@babel/parser";

export type Node = any;

const TS_EXT = /\.(ts|tsx|mts|cts)$/i;
const JSX_EXT = /\.(jsx|tsx)$/i;
const JS_EXT = /\.(js|jsx|mjs|cjs)$/i;

/** Syntax that is not tied to TypeScript or JSX, so it is always safe to allow. */
const BASE_PLUGINS: ParserPlugin[] = [
  "decorators-legacy",
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "importAttributes",
  "explicitResourceManagement",
];

const PARSE_OPTIONS: ParserOptions = {
  sourceType: "unambiguous",
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowSuperOutsideMethod: true,
  allowUndeclaredExports: true,
  errorRecovery: true,
  ranges: false,
  attachComment: false,
};

function pluginsFor(filename: string): ParserPlugin[] {
  // Default to enabling both TS and JSX unless the extension rules one out.
  // .ts cannot enable jsx safely because of the generic arrow ambiguity.
  const isTs = TS_EXT.test(filename) || !JS_EXT.test(filename);
  const wantsJsx = JSX_EXT.test(filename) || !TS_EXT.test(filename);
  const plugins = [...BASE_PLUGINS];
  if (isTs) plugins.push("typescript");
  if (wantsJsx) plugins.push("jsx");
  return plugins;
}

/**
 * A second plugin set to try when the first one throws. Files are routinely
 * misnamed (JSX in a .ts file, Flow in a .js file), and a parse error means the
 * whole file goes unchecked, so one retry is worth the cost on the error path.
 */
function fallbackPluginsFor(filename: string): ParserPlugin[] | null {
  const isTs = TS_EXT.test(filename) || !JS_EXT.test(filename);
  if (isTs) {
    // TS without JSX failed; the file may actually contain JSX.
    return JSX_EXT.test(filename) ? null : [...BASE_PLUGINS, "typescript", "jsx"];
  }
  return [...BASE_PLUGINS, "jsx", "flow"];
}

export function parseFile(code: string, filename = "input.tsx"): Node {
  try {
    return parse(code, { ...PARSE_OPTIONS, plugins: pluginsFor(filename) });
  } catch (error) {
    const fallback = fallbackPluginsFor(filename);
    if (!fallback) throw error;
    try {
      return parse(code, { ...PARSE_OPTIONS, plugins: fallback });
    } catch {
      throw error; // report the primary failure, which is the more useful one
    }
  }
}

/**
 * Keys that never hold child nodes. Skipping them by name is much cheaper than
 * recursing into them and bailing out on a type check.
 */
const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "range",
  "type",
  "extra",
  "comments",
  "tokens",
  "errors",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);

/**
 * Depth first walk over every node. `visit` receives the node and its parent,
 * and may return `false` to skip that node's children.
 *
 * Babel produces a tree rather than a graph, so this does not need a visited
 * set; dropping it removes an allocation proportional to the node count.
 */
export function walk(root: Node, visit: (node: Node, parent: Node | null) => void | boolean): void {
  const step = (node: Node, parent: Node | null): void => {
    if (node === null || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) step(node[i], parent);
      return;
    }
    if (typeof node.type !== "string") return;

    if (visit(node, parent) === false) return;

    for (const key in node) {
      if (SKIP_KEYS.has(key)) continue;
      const value = node[key];
      if (value !== null && typeof value === "object") step(value, node);
    }
  };

  step(root, null);
}

/**
 * Optional chaining produces its own node types. Everything that reads a call
 * or a member has to accept both spellings or `ref.current?.animate(...)`, the
 * ordinary way to reach the Web Animations API from React, goes unseen.
 */
export function isCallNode(node: Node): boolean {
  const type = node?.type;
  return type === "CallExpression" || type === "OptionalCallExpression";
}

export function isMemberNode(node: Node): boolean {
  const type = node?.type;
  return type === "MemberExpression" || type === "OptionalMemberExpression";
}

/** Strips wrappers that do not change the value: parens, `as T`, `!`, `satisfies`. */
export function unwrap(node: Node): Node {
  let current = node;
  while (current && typeof current === "object") {
    const type = current.type;
    if (
      type === "TSAsExpression" ||
      type === "TSSatisfiesExpression" ||
      type === "TSNonNullExpression" ||
      type === "TSTypeAssertion" ||
      type === "TSInstantiationExpression" ||
      type === "ParenthesizedExpression" ||
      type === "TypeCastExpression"
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
  return current;
}

/** Turns `a.b.c` into "a.b.c". Returns null for computed or dynamic paths. */
export function memberPath(node: Node): string | null {
  const target = unwrap(node);
  if (!target) return null;
  if (target.type === "Identifier") return target.name;
  if (target.type === "ThisExpression") return "this";
  if (isMemberNode(target)) {
    if (target.computed) return null;
    const object = memberPath(target.object);
    const property = target.property?.name;
    if (!object || !property) return null;
    return `${object}.${property}`;
  }
  if (target.type === "JSXIdentifier") return target.name;
  if (target.type === "JSXMemberExpression") {
    const object = memberPath(target.object);
    const property = target.property?.name;
    if (!object || !property) return null;
    return `${object}.${property}`;
  }
  return null;
}

/** Last segment of a dotted path. */
export function tail(path: string | null): string | null {
  if (!path) return null;
  const index = path.lastIndexOf(".");
  return index === -1 ? path : path.slice(index + 1);
}

/** First segment of a dotted path. */
export function head(path: string | null): string | null {
  if (!path) return null;
  const index = path.indexOf(".");
  return index === -1 ? path : path.slice(0, index);
}

/**
 * The called method name, even when the receiver is itself a call.
 * `memberPath` returns null for `a().b()` because the path is not static,
 * but the method name is still what the rules need.
 */
export function calleeName(callee: Node): string | null {
  const target = unwrap(callee);
  if (!target) return null;
  if (target.type === "Identifier") return target.name;
  if (isMemberNode(target) && !target.computed) {
    return target.property?.name ?? null;
  }
  return null;
}

/** The name of a non-computed object property or class member. */
export function propertyName(prop: Node): string | null {
  if (!prop || prop.computed) return null;
  const key = prop.key;
  if (!key) return null;
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  return null;
}

/** Reads a property off an ObjectExpression by name. Returns the value node. */
export function getProp(object: Node, name: string): Node | null {
  const target = unwrap(object);
  if (!target || target.type !== "ObjectExpression") return null;
  const properties = target.properties;
  if (!Array.isArray(properties)) return null;
  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i];
    if (!prop) continue;
    if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
    if (propertyName(prop) === name) return prop.value;
  }
  return null;
}

/** Reads a nested property path, for example ["transition", "repeat"]. */
export function getPropPath(object: Node, path: string[]): Node | null {
  let current: Node | null = object;
  for (const key of path) {
    if (!current) return null;
    current = getProp(current, key);
  }
  return current;
}

export function numberValue(node: Node): number | null {
  const target = unwrap(node);
  if (!target) return null;
  if (target.type === "NumericLiteral") {
    return Number.isFinite(target.value) ? target.value : null;
  }
  if (target.type === "UnaryExpression" && target.operator === "-") {
    const inner = numberValue(target.argument);
    return inner === null ? null : -inner;
  }
  if (target.type === "UnaryExpression" && target.operator === "+") {
    return numberValue(target.argument);
  }
  return null;
}

export function stringValue(node: Node): string | null {
  const target = unwrap(node);
  if (!target) return null;
  if (target.type === "StringLiteral") return target.value;
  if (target.type === "TemplateLiteral" && target.expressions.length === 0) {
    let out = "";
    for (const quasi of target.quasis) out += quasi.value.cooked ?? quasi.value.raw ?? "";
    return out;
  }
  return null;
}

export function isInfinity(node: Node): boolean {
  const target = unwrap(node);
  if (!target) return false;
  if (target.type === "Identifier" && target.name === "Infinity") return true;
  if (isMemberNode(target)) {
    const path = memberPath(target);
    return path === "Number.POSITIVE_INFINITY" || path === "Number.MAX_SAFE_INTEGER";
  }
  return false;
}

/** Tri-state boolean: `null` when the value cannot be read statically. */
export function booleanValue(node: Node): boolean | null {
  const target = unwrap(node);
  if (!target) return null;
  if (target.type === "BooleanLiteral") return target.value;
  if (target.type === "NullLiteral") return false;
  if (target.type === "NumericLiteral") return target.value !== 0;
  if (target.type === "StringLiteral") return target.value.length > 0;
  if (target.type === "Identifier" && target.name === "undefined") return false;
  return null;
}

export function isTrue(node: Node): boolean {
  return booleanValue(node) === true;
}

/** Finds a JSX attribute node by name. */
export function getJsxAttr(element: Node, name: string): Node | null {
  const attrs = element?.openingElement?.attributes ?? element?.attributes;
  if (!Array.isArray(attrs)) return null;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (attr?.type !== "JSXAttribute") continue;
    if (attr.name?.name === name) return attr;
  }
  return null;
}

/** The expression behind a JSX attribute, unwrapping `{...}`. */
export function jsxAttrValue(attr: Node): Node | null {
  if (!attr) return null;
  const value = attr.value;
  if (!value) return null; // bare attribute, for example `loop`
  if (value.type === "JSXExpressionContainer") return value.expression;
  return value;
}

/** Source position of a node, using Babel's own line and column data. */
export interface Span {
  start: number;
  end: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** Babel columns are 0 based; every position this tool reports is 1 based. */
export function spanOf(node: Node): Span | null {
  const loc = node?.loc;
  if (!loc?.start || !loc?.end) return null;
  return {
    start: node.start ?? 0,
    end: node.end ?? node.start ?? 0,
    startLine: loc.start.line,
    startColumn: loc.start.column + 1,
    endLine: loc.end.line,
    endColumn: loc.end.column + 1,
  };
}

/**
 * Maps character offsets to 1 based line and column numbers.
 *
 * Only needed for findings whose node carried no position data, which the
 * parser makes rare, so the line index is built on first use. A clean file
 * never pays for a scan of its own source.
 */
export function createLocator(code: string): (offset: number) => { line: number; column: number } {
  let lineStarts: number[] | null = null;
  return (offset: number) => {
    if (lineStarts === null) {
      lineStarts = [0];
      for (let i = 0; i < code.length; i++) {
        if (code.charCodeAt(i) === 10) lineStarts.push(i + 1);
      }
    }
    const target = offset < 0 ? 0 : offset;
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid]! <= target) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: target - lineStarts[low]! + 1 };
  };
}
