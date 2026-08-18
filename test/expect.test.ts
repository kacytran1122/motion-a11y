import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { expect } from "./expect.js";

/**
 * The assertion helper is the one piece of test machinery written here rather
 * than taken from the standard library, so it is itself tested. A matcher that
 * silently passed everything would quietly disarm the whole suite.
 */

/** Asserts that the given assertion fails, which is what most of this file does. */
function fails(fn: () => void): void {
  assert.throws(fn, assert.AssertionError, "expected this assertion to fail, but it passed");
}

/** Asserts that the given assertion passes. */
function passes(fn: () => void): void {
  fn();
}

describe("expect helper", () => {
  it("toBe compares by identity", () => {
    passes(() => expect(1).toBe(1));
    passes(() => expect(NaN).toBe(NaN));
    fails(() => expect(1).toBe(2));
    fails(() => expect("1" as unknown as number).toBe(1));
    fails(() => expect(1).not.toBe(1));
    passes(() => expect(1).not.toBe(2));
  });

  it("toEqual compares deeply and strictly", () => {
    passes(() => expect({ a: [1, 2] }).toEqual({ a: [1, 2] }));
    fails(() => expect({ a: [1, 2] }).toEqual({ a: [1, 3] }));
    fails(() => expect({ a: 1 }).toEqual({ a: 1, b: undefined }));
    passes(() => expect({ a: 1 }).not.toEqual({ a: 2 }));
    fails(() => expect({ a: 1 }).not.toEqual({ a: 1 }));
  });

  it("toContain works on arrays and strings", () => {
    passes(() => expect([1, 2]).toContain(2));
    fails(() => expect([1, 2]).toContain(3));
    passes(() => expect("hello").toContain("ell"));
    fails(() => expect("hello").toContain("xyz"));
    passes(() => expect([1, 2]).not.toContain(3));
    fails(() => expect([1, 2]).not.toContain(1));
    // A silent pass on a non-collection would hide real failures.
    fails(() => expect(42 as unknown as number[]).toContain(42));
  });

  it("toHaveLength reads the length", () => {
    passes(() => expect([1, 2]).toHaveLength(2));
    passes(() => expect("ab").toHaveLength(2));
    fails(() => expect([1, 2]).toHaveLength(3));
    fails(() => expect([]).toHaveLength(1));
    fails(() => expect(undefined as unknown as unknown[]).toHaveLength(0));
  });

  it("toMatch tests a pattern", () => {
    passes(() => expect("abc").toMatch(/b/));
    fails(() => expect("abc").toMatch(/z/));
    fails(() => expect(123 as unknown as string).toMatch(/1/));
    passes(() => expect("abc").not.toMatch(/z/));
  });

  it("null, undefined and defined checks are distinct", () => {
    passes(() => expect(null).toBeNull());
    fails(() => expect(undefined).toBeNull());
    fails(() => expect(0).toBeNull());
    passes(() => expect(undefined).toBeUndefined());
    fails(() => expect(null).toBeUndefined());
    passes(() => expect(null).toBeDefined());
    fails(() => expect(undefined).toBeDefined());
  });

  it("truthiness checks", () => {
    passes(() => expect("a").toBeTruthy());
    fails(() => expect("").toBeTruthy());
    passes(() => expect(0).toBeFalsy());
    fails(() => expect(1).toBeFalsy());
  });

  it("numeric comparisons", () => {
    passes(() => expect(2).toBeGreaterThan(1));
    fails(() => expect(1).toBeGreaterThan(1));
    passes(() => expect(1).toBeGreaterThanOrEqual(1));
    fails(() => expect(0).toBeGreaterThanOrEqual(1));
    passes(() => expect(1).toBeLessThan(2));
    fails(() => expect(2).toBeLessThan(2));
    passes(() => expect(2).toBeLessThanOrEqual(2));
    fails(() => expect(3).toBeLessThanOrEqual(2));
  });

  it("toThrow requires a throw and can match the message", () => {
    const boom = () => {
      throw new Error("boom hard");
    };
    passes(() => expect(boom).toThrow());
    passes(() => expect(boom).toThrow(/boom/));
    fails(() => expect(boom).toThrow(/quiet/));
    fails(() => expect(() => 1).toThrow());
    passes(() => expect(() => 1).not.toThrow());
    fails(() => expect(boom).not.toThrow());
  });

  it("toHaveBeenCalled reads a node:test mock", () => {
    const never = mock.fn();
    const once = mock.fn();
    once();
    passes(() => expect(once).toHaveBeenCalled());
    fails(() => expect(never).toHaveBeenCalled());
    passes(() => expect(never).not.toHaveBeenCalled());
  });

  it("includes the label in the failure message", () => {
    assert.throws(
      () => expect(1, "the widget count").toBe(2),
      (error: Error) => error.message.includes("the widget count"),
    );
  });
});
