import { parse } from "@babel/parser";

export type Node = any;

const TS_EXT = /\.(ts|tsx|mts|cts)$/i;
const JSX_EXT = /\.(jsx|tsx)$/i;

export function parseFile(code: string, filename = "input.tsx"): Node {
  const plugins: any[] = ["jsx", "decorators-legacy", "classProperties"];
  // Default to enabling both TS and JSX unless the extension rules one out.
  // .ts cannot enable jsx safely because of the generic arrow ambiguity.
  const isTs = TS_EXT.test(filename) || !/\.(js|jsx|mjs|cjs)$/i.test(filename);
  const wantsJsx = JSX_EXT.test(filename) || !TS_EXT.test(filename);
  if (isTs) plugins.push("typescript");
  if (!wantsJsx) {
    const i = plugins.indexOf("jsx");
    if (i !== -1) plugins.splice(i, 1);
  }
  return parse(code, {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    errorRecovery: true,
    plugins,
  });
}

/** Depth first walk over every node, with the parent chain available. */
export function walk(root: Node, visit: (node: Node, parents: Node[]) => void): void {
  const parents: Node[] = [];
  const seen = new Set<Node>();

  const step = (node: Node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) step(child);
      return;
    }
    if (typeof node.type !== "string") return;
    if (seen.has(node)) return;
    seen.add(node);

    visit(node, parents);

    parents.push(node);
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;
      if (key === "comments" || key === "tokens" || key === "extra") continue;
      step(node[key]);
    }
    parents.pop();
  };

  step(root);
}

/** Turns `a.b.c` into "a.b.c". Returns null for computed or dynamic paths. */
export function memberPath(node: Node): string | null {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "ThisExpression") return "this";
  if (node.type === "MemberExpression") {
    if (node.computed) return null;
    const object = memberPath(node.object);
    const property = node.property?.name;
    if (!object || !property) return null;
    return `${object}.${property}`;
  }
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXMemberExpression") {
    const object = memberPath(node.object);
    const property = node.property?.name;
    if (!object || !property) return null;
    return `${object}.${property}`;
  }
  return null;
}

/** Last segment of a dotted path. */
export function tail(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split(".");
  return parts[parts.length - 1] ?? null;
}

/**
 * The called method name, even when the receiver is itself a call.
 * `memberPath` returns null for `a().b()` because the path is not static,
 * but the method name is still what the rules need.
 */
export function calleeName(callee: Node): string | null {
  if (!callee) return null;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed) {
    return callee.property?.name ?? null;
  }
  return null;
}

/** Reads a property off an ObjectExpression by name. Returns the value node. */
export function getProp(object: Node, name: string): Node | null {
  if (!object || object.type !== "ObjectExpression") return null;
  for (const prop of object.properties) {
    if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
    if (prop.computed) continue;
    const key = prop.key?.name ?? prop.key?.value;
    if (key === name) return prop.value;
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
  if (!node) return null;
  if (node.type === "NumericLiteral") return node.value;
  if (node.type === "UnaryExpression" && node.operator === "-") {
    const inner = numberValue(node.argument);
    return inner === null ? null : -inner;
  }
  return null;
}

export function stringValue(node: Node): string | null {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((q: Node) => q.value.cooked ?? "").join("");
  }
  return null;
}

export function isInfinity(node: Node): boolean {
  if (!node) return false;
  if (node.type === "Identifier" && node.name === "Infinity") return true;
  if (node.type === "MemberExpression") {
    return memberPath(node) === "Number.POSITIVE_INFINITY";
  }
  return false;
}

export function isTrue(node: Node): boolean {
  return node?.type === "BooleanLiteral" && node.value === true;
}

/** Finds a JSX attribute node by name. */
export function getJsxAttr(element: Node, name: string): Node | null {
  const attrs = element?.openingElement?.attributes ?? element?.attributes;
  if (!Array.isArray(attrs)) return null;
  for (const attr of attrs) {
    if (attr.type !== "JSXAttribute") continue;
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
