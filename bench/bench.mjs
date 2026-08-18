// Benchmarks the built library in dist/. Run: npm run build && node bench/bench.mjs
import { makeCorpus } from "./fixtures.mjs";
import { performance } from "node:perf_hooks";

// MOTION_A11Y_TARGET lets the same harness measure another build, which is how
// the before and after numbers are taken under identical conditions.
const target = process.env.MOTION_A11Y_TARGET ?? new URL("../dist/index.js", import.meta.url).href;
const { lint } = await import(target);

const label = process.argv[2] ?? "run";

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    mean: sum / sorted.length,
    p50: at(50),
    p95: at(95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function peakRss() {
  return process.memoryUsage().rss;
}

/** Runs `fn` `iters` times after `warmup` warmup rounds, returning per-iteration ms. */
function time(fn, iters, warmup = 3) {
  for (let i = 0; i < warmup; i++) fn();
  const samples = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return samples;
}

const report = {
  label,
  node: process.version,
  throughput: {},
  scaling: [],
  memory: {},
  correctness: {},
};

// ---- 1. Throughput on a 500 file corpus -----------------------------------
const corpus = makeCorpus(500, 4);
const totalBytes = corpus.reduce((n, f) => n + Buffer.byteLength(f.code), 0);
function measureCorpus(options) {
  const run = () => {
    let messages = 0;
    for (const f of corpus)
      messages += lint(f.code, { filename: f.filename, ...options }).messages.length;
    return messages;
  };
  const messageCount = run();
  const st = stats(time(run, 12));
  return {
    files: corpus.length,
    bytes: totalBytes,
    kbPerFile: +(totalBytes / corpus.length / 1024).toFixed(2),
    msMean: +st.mean.toFixed(2),
    msP50: +st.p50.toFixed(2),
    msP95: +st.p95.toFixed(2),
    filesPerSec: Math.round(corpus.length / (st.mean / 1000)),
    mbPerSec: +(totalBytes / 1024 / 1024 / (st.mean / 1000)).toFixed(2),
    messages: messageCount,
  };
}
// `prefilter: false` is the apples-to-apples engine comparison against the
// baseline; the default is what a real run does.
report.throughput = measureCorpus({ prefilter: false });
report.throughputWithPrefilter = measureCorpus({});

// ---- 2. Scaling: is it linear in input size? ------------------------------
for (const bulk of [1, 4, 16, 64, 256]) {
  const files = makeCorpus(40, bulk);
  const bytes = files.reduce((n, f) => n + Buffer.byteLength(f.code), 0);
  const run = () => {
    for (const f of files) lint(f.code, { filename: f.filename, prefilter: false });
  };
  const sc = stats(time(run, 6, 2));
  report.scaling.push({
    bulk,
    bytes,
    kb: +(bytes / 1024).toFixed(1),
    msMean: +sc.mean.toFixed(2),
    usPerKb: +((sc.mean * 1000) / (bytes / 1024)).toFixed(2),
  });
}

// ---- 3. Memory: live heap after a long run, and peak during it ------------
// heapUsed after a forced collection is the number that shows retention; RSS
// alone reflects whatever the allocator has not handed back yet.
const settle = () => {
  if (global.gc) {
    global.gc();
    global.gc();
  }
  return process.memoryUsage().heapUsed;
};
const big = makeCorpus(2000, 8);
const heapBefore = settle();
let peakHeap = heapBefore;
let peakRssSeen = peakRss();
for (const f of big) {
  lint(f.code, { filename: f.filename, prefilter: false });
  const usage = process.memoryUsage();
  if (usage.heapUsed > peakHeap) peakHeap = usage.heapUsed;
  if (usage.rss > peakRssSeen) peakRssSeen = usage.rss;
}
const heapAfter = settle();
report.memory = {
  filesLinted: big.length,
  bytesLinted: big.reduce((n, f) => n + Buffer.byteLength(f.code), 0),
  heapBeforeMb: +(heapBefore / 1048576).toFixed(2),
  heapPeakMb: +(peakHeap / 1048576).toFixed(2),
  heapAfterMb: +(heapAfter / 1048576).toFixed(2),
  // Retained after the run: anything meaningfully above zero is a leak.
  retainedMb: +((heapAfter - heapBefore) / 1048576).toFixed(2),
  rssPeakMb: +(peakRssSeen / 1048576).toFixed(1),
};

// ---- 4. Single large file: worst case latency ------------------------------
const huge = makeCorpus(1, 4000)[0];
const hugeSamples = stats(
  time(() => lint(huge.code, { filename: huge.filename, prefilter: false }), 5, 1),
);
report.largeFile = {
  kb: +(Buffer.byteLength(huge.code) / 1024).toFixed(1),
  msMean: +hugeSamples.mean.toFixed(2),
};

console.log(JSON.stringify(report, null, 2));
