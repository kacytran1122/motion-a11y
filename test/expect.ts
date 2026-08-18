import assert from "node:assert/strict";
import { inspect } from "node:util";

/**
 * A small assertion helper over `node:assert`.
 *
 * The test runner is Node's own, which keeps the toolchain to a parser and a
 * type stripper. This is the one piece that runner does not provide: a fluent
 * wrapper so the assertions read as sentences. Every matcher delegates to
 * `node:assert`, so failures come out in the standard format.
 */

const show = (value: unknown): string => inspect(value, { depth: 3, breakLength: 100 });

interface Sized {
  length: number;
}

class Expectation<T> {
  constructor(
    private readonly actual: T,
    private readonly label: string | undefined,
    private readonly negated: boolean,
  ) {}

  get not(): Expectation<T> {
    return new Expectation(this.actual, this.label, !this.negated);
  }

  /** Every matcher funnels through here so negation and messages stay uniform. */
  private assert(passed: boolean, describe: string): void {
    if (passed !== this.negated) return;
    const prefix = this.label ? `${this.label}\n` : "";
    assert.fail(`${prefix}expected ${show(this.actual)} ${this.negated ? "not " : ""}${describe}`);
  }

  toBe(expected: T): void {
    this.assert(Object.is(this.actual, expected), `to be ${show(expected)}`);
  }

  toEqual(expected: unknown): void {
    let same = true;
    try {
      assert.deepStrictEqual(this.actual, expected);
    } catch {
      same = false;
    }
    this.assert(same, `to deeply equal ${show(expected)}`);
  }

  toContain(needle: unknown): void {
    const actual = this.actual;
    if (typeof actual === "string") {
      this.assert(actual.includes(String(needle)), `to contain ${show(needle)}`);
      return;
    }
    if (!Array.isArray(actual)) {
      assert.fail(`toContain needs a string or an array, got ${show(actual)}`);
    }
    this.assert(actual.includes(needle), `to contain ${show(needle)}`);
  }

  toHaveLength(expected: number): void {
    const actual = this.actual as unknown as Sized | null | undefined;
    const length = actual?.length;
    this.assert(length === expected, `to have length ${expected}, got ${show(length)}`);
  }

  toMatch(pattern: RegExp): void {
    this.assert(typeof this.actual === "string" && pattern.test(this.actual), `to match ${pattern}`);
  }

  toBeNull(): void {
    this.assert(this.actual === null, "to be null");
  }

  toBeUndefined(): void {
    this.assert(this.actual === undefined, "to be undefined");
  }

  toBeDefined(): void {
    this.assert(this.actual !== undefined, "to be defined");
  }

  toBeTruthy(): void {
    this.assert(Boolean(this.actual), "to be truthy");
  }

  toBeFalsy(): void {
    this.assert(!this.actual, "to be falsy");
  }

  toBeGreaterThan(expected: number): void {
    this.assert(Number(this.actual) > expected, `to be greater than ${expected}`);
  }

  toBeGreaterThanOrEqual(expected: number): void {
    this.assert(Number(this.actual) >= expected, `to be at least ${expected}`);
  }

  toBeLessThan(expected: number): void {
    this.assert(Number(this.actual) < expected, `to be less than ${expected}`);
  }

  toBeLessThanOrEqual(expected: number): void {
    this.assert(Number(this.actual) <= expected, `to be at most ${expected}`);
  }

  toThrow(pattern?: RegExp): void {
    assert.equal(typeof this.actual, "function", "toThrow needs a function");
    let thrown: unknown;
    let threw = false;
    try {
      (this.actual as unknown as () => unknown)();
    } catch (error) {
      threw = true;
      thrown = error;
    }
    if (this.negated) {
      this.assert(threw, "to throw");
      return;
    }
    if (!threw) assert.fail(`${this.label ? `${this.label}\n` : ""}expected the call to throw`);
    if (!pattern) return;
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    assert.match(message, pattern);
  }

  /** For a function created with `mock.fn()` from node:test. */
  toHaveBeenCalled(): void {
    const fn = this.actual as unknown as { mock?: { callCount(): number } };
    const count = fn?.mock?.callCount?.() ?? 0;
    this.assert(count > 0, `to have been called, got ${count} calls`);
  }
}

export function expect<T>(actual: T, label?: string): Expectation<T> {
  return new Expectation(actual, label, false);
}
