import { describe, it, mock } from "node:test";
import { expect } from "./expect.js";
import {
  booleanValue,
  calleeName,
  createLocator,
  getJsxAttr,
  getProp,
  getPropPath,
  head,
  isInfinity,
  isTrue,
  jsxAttrValue,
  memberPath,
  numberValue,
  parseFile,
  propertyName,
  spanOf,
  stringValue,
  tail,
  unwrap,
  walk,
} from "../src/ast.js";

/** Parses an expression statement and hands back the expression node. */
function expr(code: string, filename = "a.ts") {
  const ast = parseFile(`(${code});`, filename);
  return ast.program.body[0].expression;
}

describe("memberPath", () => {
  it("reads a dotted path", () => {
    expect(memberPath(expr("a.b.c"))).toBe("a.b.c");
  });

  it("refuses a computed path", () => {
    expect(memberPath(expr("a[b].c"))).toBeNull();
  });

  it("reads this", () => {
    expect(memberPath(expr("this.a"))).toBe("this.a");
  });

  it("sees through a non-null assertion", () => {
    expect(memberPath(expr("a!.b"))).toBe("a.b");
  });

  it("returns null for a call receiver", () => {
    expect(memberPath(expr("a().b"))).toBeNull();
  });

  it("returns null for nothing", () => {
    expect(memberPath(null)).toBeNull();
    expect(memberPath(undefined)).toBeNull();
  });
});

describe("head and tail", () => {
  it("splits a dotted path", () => {
    expect(head("a.b.c")).toBe("a");
    expect(tail("a.b.c")).toBe("c");
  });

  it("handles a single segment", () => {
    expect(head("a")).toBe("a");
    expect(tail("a")).toBe("a");
  });

  it("handles null", () => {
    expect(head(null)).toBeNull();
    expect(tail(null)).toBeNull();
  });
});

describe("calleeName", () => {
  it("reads the method name off a call receiver", () => {
    expect(calleeName(expr("a().b").callee ?? expr("a().b"))).toBe("b");
  });

  it("reads a bare identifier", () => {
    expect(calleeName(expr("fn"))).toBe("fn");
  });

  it("refuses a computed member", () => {
    expect(calleeName(expr("a[b]"))).toBeNull();
    expect(calleeName(null)).toBeNull();
  });
});

describe("value readers", () => {
  it("reads numbers, including signs", () => {
    expect(numberValue(expr("5"))).toBe(5);
    expect(numberValue(expr("-5"))).toBe(-5);
    expect(numberValue(expr("+5"))).toBe(5);
    expect(numberValue(expr("5 as number"))).toBe(5);
    expect(numberValue(expr("a"))).toBeNull();
    expect(numberValue(null)).toBeNull();
  });

  it("reads strings and simple templates", () => {
    expect(stringValue(expr('"a"'))).toBe("a");
    expect(stringValue(expr("`a`"))).toBe("a");
    expect(stringValue(expr("`a${b}c`"))).toBeNull();
    expect(stringValue(expr("a"))).toBeNull();
    expect(stringValue(null)).toBeNull();
  });

  it("reads booleans as a tri-state", () => {
    expect(booleanValue(expr("true"))).toBe(true);
    expect(booleanValue(expr("false"))).toBe(false);
    expect(booleanValue(expr("null"))).toBe(false);
    expect(booleanValue(expr("undefined"))).toBe(false);
    expect(booleanValue(expr("0"))).toBe(false);
    expect(booleanValue(expr("1"))).toBe(true);
    expect(booleanValue(expr('""'))).toBe(false);
    expect(booleanValue(expr("someFlag"))).toBeNull();
    expect(booleanValue(null)).toBeNull();
    expect(isTrue(expr("true"))).toBe(true);
    expect(isTrue(expr("someFlag"))).toBe(false);
  });

  it("recognises endless values", () => {
    expect(isInfinity(expr("Infinity"))).toBe(true);
    expect(isInfinity(expr("Number.POSITIVE_INFINITY"))).toBe(true);
    expect(isInfinity(expr("Number.MAX_SAFE_INTEGER"))).toBe(true);
    expect(isInfinity(expr("Number.EPSILON"))).toBe(false);
    expect(isInfinity(expr("5"))).toBe(false);
    expect(isInfinity(null)).toBe(false);
  });

  it("unwraps typescript expression wrappers", () => {
    expect(unwrap(expr("(5 as number)!")).type).toBe("NumericLiteral");
    expect(unwrap(null)).toBeNull();
  });
});

describe("object readers", () => {
  it("reads a property by name", () => {
    const object = expr("{ a: 1, 'b': 2, [c]: 3 }");
    expect(numberValue(getProp(object, "a"))).toBe(1);
    expect(numberValue(getProp(object, "b"))).toBe(2);
    expect(getProp(object, "c")).toBeNull();
    expect(getProp(object, "missing")).toBeNull();
    expect(getProp(expr("5"), "a")).toBeNull();
    expect(getProp(null, "a")).toBeNull();
  });

  it("skips a spread element", () => {
    expect(getProp(expr("{ ...rest, a: 1 }"), "a")).not.toBeNull();
    expect(getProp(expr("{ ...rest }"), "a")).toBeNull();
  });

  it("reads a nested path", () => {
    const object = expr("{ a: { b: { c: 7 } } }");
    expect(numberValue(getPropPath(object, ["a", "b", "c"]))).toBe(7);
    expect(getPropPath(object, ["a", "x", "c"])).toBeNull();
  });

  it("names a property", () => {
    const object = expr("{ a: 1 }");
    expect(propertyName(object.properties[0])).toBe("a");
    expect(propertyName(expr("{ [x]: 1 }").properties[0])).toBeNull();
    expect(propertyName(null)).toBeNull();
  });
});

describe("jsx readers", () => {
  const element = parseFile(`<A loop autoplay={false} name="x" />;`, "a.tsx").program.body[0]
    .expression;

  it("finds an attribute", () => {
    expect(getJsxAttr(element, "loop")).not.toBeNull();
    expect(getJsxAttr(element, "missing")).toBeNull();
    expect(getJsxAttr(null, "loop")).toBeNull();
  });

  it("unwraps the attribute value", () => {
    expect(jsxAttrValue(getJsxAttr(element, "loop"))).toBeNull(); // bare attribute
    expect(booleanValue(jsxAttrValue(getJsxAttr(element, "autoplay")))).toBe(false);
    expect(stringValue(jsxAttrValue(getJsxAttr(element, "name")))).toBe("x");
    expect(jsxAttrValue(null)).toBeNull();
  });
});

describe("walk", () => {
  it("visits every node with its parent", () => {
    const ast = parseFile(`const a = { b: 1 };`, "a.ts");
    const seen: string[] = [];
    walk(ast, (node, parent) => {
      seen.push(node.type);
      if (node.type === "ObjectProperty") expect(parent.type).toBe("ObjectExpression");
    });
    expect(seen).toContain("VariableDeclarator");
    expect(seen).toContain("NumericLiteral");
  });

  it("skips a subtree when the visitor returns false", () => {
    const ast = parseFile(`const a = { b: 1 };`, "a.ts");
    const seen: string[] = [];
    walk(ast, (node) => {
      seen.push(node.type);
      if (node.type === "ObjectExpression") return false;
      return undefined;
    });
    expect(seen).toContain("ObjectExpression");
    expect(seen).not.toContain("ObjectProperty");
  });

  it("ignores a non-node root", () => {
    const visit = mock.fn();
    walk(null, visit);
    walk(42, visit);
    walk({ notANode: true }, visit);
    expect(visit).not.toHaveBeenCalled();
  });
});

describe("spanOf", () => {
  it("converts to 1 based columns", () => {
    const ast = parseFile(`const a = 1;`, "a.ts");
    const span = spanOf(ast.program.body[0])!;
    expect(span.startLine).toBe(1);
    expect(span.startColumn).toBe(1);
  });

  it("returns null for a node with no position", () => {
    expect(spanOf({ type: "Identifier" })).toBeNull();
    expect(spanOf(null)).toBeNull();
  });
});

describe("createLocator", () => {
  const code = "one\ntwo\nthree";

  it("maps offsets to 1 based positions", () => {
    const locate = createLocator(code);
    expect(locate(0)).toEqual({ line: 1, column: 1 });
    expect(locate(4)).toEqual({ line: 2, column: 1 });
    expect(locate(6)).toEqual({ line: 2, column: 3 });
    expect(locate(8)).toEqual({ line: 3, column: 1 });
  });

  it("clamps an offset below the start", () => {
    expect(createLocator(code)(-5)).toEqual({ line: 1, column: 1 });
  });

  it("puts an offset past the end on the last line", () => {
    expect(createLocator(code)(9999).line).toBe(3);
  });

  it("handles an empty source", () => {
    expect(createLocator("")(0)).toEqual({ line: 1, column: 1 });
  });
});

describe("parseFile", () => {
  it("falls back to a JSX capable plugin set for a .ts file", () => {
    const ast = parseFile(`export const A = () => <div />;`, "a.ts");
    expect(ast.program.body).toHaveLength(1);
  });

  it("falls back to flow for a .js file", () => {
    const ast = parseFile(`function f(x: number): number { return x; }`, "a.js");
    expect(ast.program.body).toHaveLength(1);
  });

  it("reports the primary failure when both attempts fail", () => {
    expect(() => parseFile(`const = = =`, "a.js")).toThrow();
  });

  it("does not enable jsx for a .ts file by default", () => {
    // A generic arrow is only unambiguous when jsx is off.
    const ast = parseFile(`const f = <T,>(x: T) => x;`, "a.ts");
    expect(ast.program.body).toHaveLength(1);
  });
});
