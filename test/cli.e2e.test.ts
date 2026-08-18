import { describe, it, before, after } from "node:test";
import { expect } from "./expect.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "cli.js");
const built = existsSync(cli);

// Silently skipping the only end to end coverage in CI would be worse than a
// noisy failure, so make a missing build loud there.
if (!built && process.env.CI) {
  throw new Error("dist/cli.js is missing. Run `npm run build` before `npm test`.");
}

let project: string;

before(() => {
  project = mkdtempSync(join(tmpdir(), "motion-a11y-e2e-"));
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(
    join(project, "src", "Spinner.tsx"),
    `import { motion } from "framer-motion";\n` +
      `export const Spinner = () => (\n` +
      `  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2 }} />\n` +
      `);\n`,
  );
  writeFileSync(
    join(project, "src", "scroll.ts"),
    `export const top = () => window.scrollTo({ top: 0, behavior: "smooth" });\n`,
  );
  writeFileSync(
    join(project, "src", "clean.ts"),
    `export const add = (a: number, b: number) => a + b;\n`,
  );

  // Enough findings to push the JSON report well past the 64KB pipe buffer.
  mkdirSync(join(project, "bulk"), { recursive: true });
  for (let i = 0; i < 300; i++) {
    writeFileSync(
      join(project, "bulk", `F${i}.ts`),
      `import gsap from "gsap";\ngsap.to(".a${i}", { x: ${i}, duration: 12, repeat: -1 });\n`,
    );
  }

  writeFileSync(
    join(project, "src", "suppressed.ts"),
    `import gsap from "gsap";\n// motion-a11y-disable-next-line\ngsap.to(".a", { x: 1, repeat: -1 });\n`,
  );
  writeFileSync(join(project, "src", "broken.ts"), `import gsap from "gsap";\nconst = = =\n`);

  mkdirSync(join(project, "generated"), { recursive: true });
  writeFileSync(
    join(project, "generated", "anim.ts"),
    `import gsap from "gsap";\ngsap.to(".g", { x: 1, repeat: -1 });\n`,
  );
});

after(() => {
  rmSync(project, { recursive: true, force: true });
});

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd = project): Run {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("cli end to end", { skip: !built }, () => {
  it("exits 1 and reports findings when there are errors", () => {
    const run = runCli(["src", "--allow-unchecked"]);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("no-infinite-animation");
    expect(run.stdout).toContain("Spinner.tsx");
  });

  it("reports paths relative to the working directory", () => {
    const run = runCli(["src", "--allow-unchecked"]);
    expect(run.stdout).toContain(join("src", "Spinner.tsx"));
    expect(run.stdout).not.toContain(project);
  });

  it("exits 0 for a clean file", () => {
    const run = runCli(["src/clean.ts"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("No animation accessibility problems found.");
  });

  it("emits parseable JSON", () => {
    const run = runCli(["src", "--format", "json", "--allow-unchecked"]);
    const parsed = JSON.parse(run.stdout);
    expect(parsed.errorCount).toBeGreaterThan(0);
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.every((r: { filename: string }) => typeof r.filename === "string")).toBe(
      true,
    );
  });

  it("does not truncate a large report written to a pipe", () => {
    // Calling process.exit() straight after console.log() drops whatever has
    // not been flushed, which cuts a piped report off at the pipe buffer.
    const run = runCli(["bulk", "--format", "json"]);
    expect(run.stdout.length).toBeGreaterThan(65536);
    const parsed = JSON.parse(run.stdout);
    expect(parsed.results.length).toBe(300);
    expect(parsed.errorCount).toBeGreaterThan(300);
  });

  it("honours an inline disable comment", () => {
    const run = runCli(["src/suppressed.ts"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("No animation accessibility problems found.");
  });

  it("fails when a file could not be checked", () => {
    const run = runCli(["src/broken.ts"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("could not be checked");
  });

  it("passes an unchecked file only when told to", () => {
    expect(runCli(["src/broken.ts", "--allow-unchecked"]).status).toBe(0);
  });

  it("skips paths matched by --ignore", () => {
    expect(runCli(["generated"]).status).toBe(1);
    expect(runCli(["generated", "--ignore", "generated/**"]).status).toBe(0);
    expect(runCli(["generated", "--ignore", "generated"]).status).toBe(0);
  });

  it("rejects an ignore negation instead of silently dropping it", () => {
    const run = runCli(["src", "--ignore", "!keep.ts"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("negation is not supported");
  });

  it("reads settings from a config file", () => {
    writeFileSync(
      join(project, "motion-a11y.config.json"),
      JSON.stringify({
        rules: { "no-infinite-animation": "off", "require-reduced-motion-guard": "off" },
      }),
    );
    try {
      expect(runCli(["generated"]).status).toBe(0);
      // An explicit flag still wins over the file.
      expect(runCli(["generated", "--rule", "no-infinite-animation=error"]).status).toBe(1);
      // And --no-config ignores the file entirely.
      expect(runCli(["generated", "--no-config"]).status).toBe(1);
    } finally {
      rmSync(join(project, "motion-a11y.config.json"), { force: true });
    }
  });

  it("rejects an invalid config file with exit 2", () => {
    writeFileSync(join(project, "motion-a11y.config.json"), JSON.stringify({ rulez: {} }));
    try {
      const run = runCli(["src"]);
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('unknown option "rulez"');
    } finally {
      rmSync(join(project, "motion-a11y.config.json"), { force: true });
    }
  });

  it("reads an ignore file", () => {
    writeFileSync(join(project, ".motion-a11yignore"), "# generated code\ngenerated/\n");
    try {
      expect(runCli(["generated"]).status).toBe(0);
    } finally {
      rmSync(join(project, ".motion-a11yignore"), { force: true });
    }
  });

  it("emits one GitHub annotation per line", () => {
    const run = runCli(["src", "--format", "github", "--allow-unchecked"]);
    const lines = run.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^::(error|warning) file=/);
  });

  it("honours --quiet by dropping warnings", () => {
    const loud = runCli(["src", "--allow-unchecked"]);
    const quiet = runCli(["src", "--quiet", "--allow-unchecked"]);
    expect(loud.stdout).toContain("no-smooth-scroll");
    expect(quiet.stdout).not.toContain("no-smooth-scroll");
  });

  it("honours --rule overrides", () => {
    const run = runCli([
      "src",
      "--rule",
      "no-infinite-animation=off",
      "--rule",
      "require-reduced-motion-guard=off",
    ]);
    expect(run.stdout).not.toContain("no-infinite-animation");
  });

  it("fails on warnings with --max-warnings 0", () => {
    const run = runCli(["src/scroll.ts", "--max-warnings", "0"]);
    expect(run.status).toBe(1);
  });

  it("passes on warnings without --max-warnings", () => {
    const run = runCli(["src/scroll.ts"]);
    expect(run.status).toBe(0);
  });

  it("raises every rule to error under --preset strict", () => {
    const run = runCli(["src/scroll.ts", "--preset", "strict"]);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("error");
  });

  it("exits 2 with a message on a bad argument", () => {
    const run = runCli(["--preset", "wild"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Unknown preset");
  });

  it("exits 2 on a path that does not exist", () => {
    const run = runCli(["does-not-exist"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Cannot read path");
  });

  it("prints help, version and the rule list without linting", () => {
    expect(runCli(["--help"]).stdout).toContain("Usage");
    expect(runCli(["--version"]).stdout).toMatch(/motion-a11y \d+\.\d+\.\d+/);
    const rules = runCli(["--rules"]);
    expect(rules.status).toBe(0);
    expect(rules.stdout).toContain("no-fast-flash");
  });
});
