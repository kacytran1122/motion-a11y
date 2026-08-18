// Deterministic synthetic corpus generator. No randomness that varies between runs.
let seed = 0x2f6e2b1;
function rnd() {
  // xorshift32, deterministic across runs and platforms.
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 0x100000000;
}
export function resetSeed(value = 0x2f6e2b1) { seed = value >>> 0; }

const FILLER = (i) => `
export function helper${i}(a: number, b: number) {
  const parts = [a, b].map((n) => n * ${i + 1});
  return parts.reduce((sum, n) => sum + n, 0);
}
interface Shape${i} { id: string; width: number; height: number; tags: string[] }
export const shape${i}: Shape${i} = { id: "s${i}", width: ${i}, height: ${i * 2}, tags: ["a", "b"] };
`;

const TEMPLATES = [
  (i) => `
import { motion } from "framer-motion";
export const Card${i} = () => (
  <motion.div animate={{ opacity: 1, x: ${i} }} transition={{ duration: 0.4, repeat: Infinity }} />
);
`,
  (i) => `
import gsap from "gsap";
gsap.to(".layer${i}", { y: -200, duration: 12, scrollTrigger: { trigger: ".layer${i}", scrub: true } });
`,
  (i) => `
import Lottie from "lottie-react";
export const Hero${i} = () => <Lottie animationData={data${i}} loop autoplay />;
`,
  (i) => `
const el${i} = document.querySelector("#a${i}");
el${i}.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, iterations: Infinity });
`,
  (i) => `
export function jump${i}() {
  document.querySelector("#top${i}").scrollIntoView({ behavior: "smooth" });
}
`,
  (i) => `
import { motion, useReducedMotion } from "framer-motion";
export const Safe${i} = () => {
  const reduce = useReducedMotion();
  return <motion.div animate={reduce ? {} : { x: ${i} }} transition={{ duration: 0.3 }} />;
};
`,
  // Files with no animation at all: the common case in a real repo.
  (i) => FILLER(i),
  (i) => FILLER(i),
  (i) => FILLER(i),
  (i) => FILLER(i),
];

/** A single file of roughly `bulk` filler blocks plus one animation template. */
export function makeFile(i, bulk = 4) {
  const template = TEMPLATES[i % TEMPLATES.length];
  let out = template(i);
  for (let b = 0; b < bulk; b++) out += FILLER(i * 31 + b);
  return out;
}

export function makeCorpus(count, bulk = 4) {
  resetSeed();
  const files = [];
  for (let i = 0; i < count; i++) {
    files.push({ filename: `src/gen/File${i}.tsx`, code: makeFile(i, bulk) });
  }
  return files;
}
