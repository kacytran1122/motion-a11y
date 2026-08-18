import { after, before, describe, it } from "node:test";
import { expect } from "./expect.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, validateConfig } from "../src/config.js";

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "motion-a11y-config-"));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("validateConfig", () => {
  it("accepts a complete, valid config", () => {
    const config = validateConfig(
      {
        preset: "strict",
        rules: { "no-smooth-scroll": "off" },
        ignore: ["dist/**"],
        extensions: [".ts"],
        maxWarnings: 0,
        quiet: true,
      },
      "test",
    );
    expect(config.preset).toBe("strict");
    expect(config.rules?.["no-smooth-scroll"]).toBe("off");
    expect(config.maxWarnings).toBe(0);
    expect(config.quiet).toBe(true);
  });

  it("accepts an empty object", () => {
    expect(validateConfig({}, "test")).toEqual({});
  });

  it("rejects anything that is not an object", () => {
    expect(() => validateConfig(null, "t")).toThrow(/expected a JSON object/);
    expect(() => validateConfig([], "t")).toThrow(/expected a JSON object/);
    expect(() => validateConfig("nope", "t")).toThrow(/expected a JSON object/);
  });

  it("rejects an unknown option so a typo is not silently ignored", () => {
    expect(() => validateConfig({ rulez: {} }, "t")).toThrow(/unknown option "rulez"/);
    expect(() => validateConfig({ Preset: "strict" }, "t")).toThrow(/unknown option/);
  });

  it("rejects an unknown preset", () => {
    expect(() => validateConfig({ preset: "wild" }, "t")).toThrow(/preset must be/);
  });

  it("rejects an unknown rule or severity", () => {
    expect(() => validateConfig({ rules: { nope: "error" } }, "t")).toThrow(/unknown rule "nope"/);
    expect(() => validateConfig({ rules: { "no-smooth-scroll": "loud" } }, "t")).toThrow(
      /off, warn or error/,
    );
    expect(() => validateConfig({ rules: [] }, "t")).toThrow(/rules must be an object/);
  });

  it("rejects malformed arrays", () => {
    expect(() => validateConfig({ ignore: "dist" }, "t")).toThrow(/array of strings/);
    expect(() => validateConfig({ extensions: [1] }, "t")).toThrow(/array of strings/);
  });

  it("rejects a bad maxWarnings or quiet", () => {
    expect(() => validateConfig({ maxWarnings: -1 }, "t")).toThrow(/zero or more/);
    expect(() => validateConfig({ maxWarnings: "5" }, "t")).toThrow(/zero or more/);
    expect(() => validateConfig({ quiet: "yes" }, "t")).toThrow(/true or false/);
  });

  it("names the source in the error, so the file can be found", () => {
    expect(() => validateConfig({ nope: 1 }, "my.config.json")).toThrow(/my\.config\.json/);
  });
});

describe("loadConfig", () => {
  it("returns an empty config when there is no file", () => {
    const loaded = loadConfig(dir);
    expect(loaded.source).toBeNull();
    expect(loaded.config).toEqual({});
  });

  it("reads motion-a11y.config.json", () => {
    writeFileSync(join(dir, "motion-a11y.config.json"), JSON.stringify({ preset: "strict" }));
    expect(loadConfig(dir).config.preset).toBe("strict");
  });

  it("prefers motion-a11y.config.json over .motion-a11yrc.json", () => {
    writeFileSync(join(dir, ".motion-a11yrc.json"), JSON.stringify({ preset: "recommended" }));
    expect(loadConfig(dir).config.preset).toBe("strict");
  });

  it("falls back to .motion-a11yrc.json", () => {
    rmSync(join(dir, "motion-a11y.config.json"));
    expect(loadConfig(dir).config.preset).toBe("recommended");
  });

  it("falls back to the package.json key", () => {
    rmSync(join(dir, ".motion-a11yrc.json"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "x", "motion-a11y": { preset: "strict" } }),
    );
    const loaded = loadConfig(dir);
    expect(loaded.config.preset).toBe("strict");
    expect(loaded.source).toContain("motion-a11y");
  });

  it("ignores a package.json with no section for us", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    expect(loadConfig(dir).source).toBeNull();
  });

  it("reports invalid JSON instead of crashing", () => {
    writeFileSync(join(dir, "motion-a11y.config.json"), "{ not json");
    expect(() => loadConfig(dir)).toThrow(/invalid JSON/);
    rmSync(join(dir, "motion-a11y.config.json"));
  });

  it("tolerates a byte order mark", () => {
    writeFileSync(join(dir, "motion-a11y.config.json"), "﻿" + JSON.stringify({ quiet: true }));
    expect(loadConfig(dir).config.quiet).toBe(true);
    rmSync(join(dir, "motion-a11y.config.json"));
  });

  it("reports a missing explicit config path", () => {
    expect(() => loadConfig(dir, join(dir, "nope.json"))).toThrow(/Cannot read config file/);
  });

  it("reads an explicit config path", () => {
    const path = join(dir, "custom.json");
    writeFileSync(path, JSON.stringify({ preset: "strict" }));
    expect(loadConfig(dir, path).config.preset).toBe("strict");
  });

  it("surfaces a validation error from package.json rather than swallowing it", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "x", "motion-a11y": { nope: 1 } }),
    );
    expect(() => loadConfig(dir)).toThrow(/unknown option "nope"/);
  });
});
