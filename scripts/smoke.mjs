/**
 * Runs the built package on the oldest Node version it claims to support.
 *
 * The test suite needs a toolchain that no longer runs on Node 18, so this
 * exercises the real artefacts in dist/ with nothing but the standard library.
 * Run it with: npm run smoke
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(import.meta.url);

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log(`motion-a11y smoke test on Node ${process.version}`);

// ---- ESM build -------------------------------------------------------------
const esm = await import(join(root, "dist", "index.js"));

check("esm build exports the public API", () => {
  assert.equal(typeof esm.lint, "function");
  assert.equal(typeof esm.mightAnimate, "function");
  assert.ok(Array.isArray(esm.RULE_IDS));
  assert.equal(esm.RULE_IDS.length, 7);
  assert.ok(esm.presets.recommended && esm.presets.strict);
});

check("finds an endless framer-motion animation", () => {
  const code = `import { motion } from "framer-motion";
    export const S = () => <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2 }} />;`;
  const result = esm.lint(code, { filename: "S.tsx" });
  const found = result.messages.map((m) => m.rule);
  assert.ok(found.includes("no-infinite-animation"), found.join(","));
  assert.ok(found.includes("require-reduced-motion-guard"), found.join(","));
  assert.equal(result.errorCount, result.messages.filter((m) => m.severity === "error").length);
});

check("follows a gsap timeline held in a local", () => {
  const code = `import gsap from "gsap";
    const tl = gsap.timeline();
    tl.to(".a", { x: 1, duration: 12 });`;
  const found = esm.lint(code, { filename: "a.ts" }).messages.map((m) => m.rule);
  assert.ok(found.includes("no-long-animation"), found.join(","));
});

check("stays quiet on a guarded file", () => {
  const code = `import { motion, useReducedMotion } from "framer-motion";
    export const B = () => {
      const reduce = useReducedMotion();
      return <motion.div animate={reduce ? {} : { x: 1 }} />;
    };`;
  const found = esm.lint(code, { filename: "B.tsx" }).messages.map((m) => m.rule);
  assert.ok(!found.includes("require-reduced-motion-guard"), found.join(","));
});

check("reports a parse failure instead of throwing", () => {
  const result = esm.lint("import gsap from 'gsap'; const = = =", { filename: "broken.ts" });
  assert.ok(result.parseError);
  assert.equal(result.messages.length, 0);
});

// ---- CJS build -------------------------------------------------------------
check("cjs build loads and behaves the same", () => {
  const cjs = require(join(root, "dist", "index.cjs"));
  assert.equal(typeof cjs.lint, "function");
  const code = `import gsap from "gsap"; gsap.to(".a", { x: 1, repeat: -1 });`;
  assert.deepEqual(
    cjs.lint(code, { filename: "a.ts" }).messages.map((m) => m.rule).sort(),
    esm.lint(code, { filename: "a.ts" }).messages.map((m) => m.rule).sort(),
  );
});

// ---- CLI -------------------------------------------------------------------
const project = mkdtempSync(join(tmpdir(), "motion-a11y-smoke-"));
try {
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(
    join(project, "src", "Spinner.tsx"),
    `import { motion } from "framer-motion";\nexport const S = () => <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2 }} />;\n`,
  );
  writeFileSync(join(project, "src", "clean.ts"), `export const add = (a, b) => a + b;\n`);

  const cli = join(root, "dist", "cli.js");
  const runCli = (args) => {
    try {
      const stdout = execFileSync(process.execPath, [cli, ...args], {
        cwd: project,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
    }
  };

  check("cli prints its version", () => {
    const run = runCli(["--version"]);
    assert.equal(run.status, 0);
    assert.match(run.stdout, /motion-a11y \d+\.\d+\.\d+/);
  });

  check("cli exits 1 and names the rule on a failing tree", () => {
    const run = runCli(["src"]);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /no-infinite-animation/);
  });

  check("cli exits 0 on a clean file", () => {
    const run = runCli(["src/clean.ts"]);
    assert.equal(run.status, 0);
  });

  check("cli emits valid json", () => {
    const run = runCli(["src", "--format", "json"]);
    const parsed = JSON.parse(run.stdout);
    assert.ok(parsed.errorCount > 0);
  });

  check("cli rejects a bad argument with exit 2", () => {
    assert.equal(runCli(["--preset", "wild"]).status, 2);
  });
} finally {
  rmSync(project, { recursive: true, force: true });
}

console.log(`\n${passed} smoke checks passed on Node ${process.version}.`);
