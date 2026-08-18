// Generates a synthetic repository and times the CLI end to end on it.
// Usage: node bench/repo.mjs [fileCount]
import { makeFile } from "./fixtures.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const count = Number(process.argv[2] ?? 3000);
const cliPaths = (process.env.MOTION_A11Y_CLIS ?? "dist/cli.js").split(",");

const repo = mkdtempSync(join(tmpdir(), "motion-a11y-repo-"));
let bytes = 0;
// A realistic tree: many directories, and animation code in a small minority
// of files, which is what the shape of a real front end repository looks like.
for (let i = 0; i < count; i++) {
  const dir = join(repo, "src", `mod${Math.floor(i / 25)}`);
  mkdirSync(dir, { recursive: true });
  // Every 20th file animates; the rest is ordinary application code.
  const code = i % 20 === 0 ? makeFile(i % 6, 4) : makeFile(6, 4);
  bytes += Buffer.byteLength(code);
  writeFileSync(join(dir, `File${i}.tsx`), code);
}

const time = (cli) => {
  const run = () => {
    const started = performance.now();
    try {
      execFileSync(process.execPath, [cli, "src", "--format", "json"], {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 256 * 1024 * 1024,
      });
    } catch {
      /* a non-zero exit just means findings were reported */
    }
    return performance.now() - started;
  };
  run(); // warm the file cache
  const samples = [run(), run(), run()].sort((a, b) => a - b);
  return samples[1];
};

console.log(`repo: ${count} files, ${(bytes / 1048576).toFixed(2)} MB`);
for (const cli of cliPaths) {
  const ms = time(cli);
  console.log(
    `  ${cli.padEnd(48)} ${ms.toFixed(0).padStart(6)} ms   ` +
      `${Math.round(count / (ms / 1000))
        .toString()
        .padStart(6)} files/s   ` +
      `${(bytes / 1048576 / (ms / 1000)).toFixed(2)} MB/s`,
  );
}
rmSync(repo, { recursive: true, force: true });
