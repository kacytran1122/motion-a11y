import { describe, expect, it, vi } from "vitest";

// One unusual file must never take down a run over a whole repository, so the
// analysis phase is wrapped. This forces that path.
vi.mock("../src/collect.js", async () => {
  const actual = await vi.importActual<typeof import("../src/collect.js")>("../src/collect.js");
  return {
    ...actual,
    collect: () => {
      throw new Error("analyser exploded");
    },
  };
});

const { lint } = await import("../src/index.js");

describe("analysis failure", () => {
  it("reports the failure per file instead of throwing", () => {
    const result = lint(`import gsap from "gsap";\ngsap.to(".a", { x: 1 });`, { filename: "a.ts" });
    expect(result.analysisError).toContain("analyser exploded");
    expect(result.messages).toHaveLength(0);
    expect(result.errorCount).toBe(0);
    expect(result.parseError).toBeUndefined();
  });

  it("still short circuits a file with no animation marker", () => {
    const result = lint(`export const add = (a, b) => a + b;`, { filename: "a.ts" });
    expect(result.analysisError).toBeUndefined();
    expect(result.messages).toHaveLength(0);
  });
});
