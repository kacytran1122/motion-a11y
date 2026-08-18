# motion-a11y

Accessibility linter for animation code.

Animation is the one part of the front end that no linter checks. `eslint-plugin-jsx-a11y` reads JSX attributes, so it cannot see a GSAP timeline. `axe-core` runs against a rendered page, so it cannot see an animation that has not started yet. `stylelint-a11y` reads CSS, so it cannot see `repeat: Infinity` inside a JavaScript object.

`motion-a11y` reads the JavaScript and TypeScript. That is where Framer Motion, Motion, GSAP, Lottie and the Web Animations API live.

```bash
npx motion-a11y src
```

```
src/Hero.tsx
  5:31   warn   useScroll ties motion to scroll position with no reduced motion guard.
                no-scroll-linked-animation  WCAG 2.3.3
  9:7    error  <motion.div> repeats opacity about 8.3 times a second. Anything over
                3 flashes a second is a seizure risk.
                no-fast-flash  WCAG 2.3.1
  14:7   error  <Lottie> repeats forever with no pause control and no reduced motion guard.
                no-infinite-animation  WCAG 2.2.2

4 errors, 3 warnings
```

## Why this matters

About 35 percent of adults over 40 have some vestibular dysfunction. For them, a parallax hero or a smooth scroll jump is not a nice touch. It causes nausea and dizziness that can last for hours.

Flashing is worse. Content that flashes more than three times a second can trigger a seizure. That is WCAG 2.3.1, and it is a Level A requirement, which means it is the floor rather than the goal.

Both problems are easy to ship by accident and easy to catch statically.

## Install

```bash
npm install --save-dev motion-a11y
```

Node 18 or newer.

## Rules

| Rule | Default | WCAG | What it catches |
| --- | --- | --- | --- |
| `require-reduced-motion-guard` | error | 2.3.3 | A file animates but never checks the user's motion preference |
| `no-infinite-animation` | error | 2.2.2 | `repeat: Infinity`, `repeat: -1`, `iterations: Infinity`, `loop` with no pause control |
| `no-fast-flash` | error | 2.3.1 | A repeating animation changes opacity or colour more than 3 times a second |
| `no-long-animation` | warn | 2.2.2 | Total run time over 5 seconds with no pause control, counting repeats |
| `no-scroll-linked-animation` | warn | 2.3.3 | `useScroll`, `ScrollTrigger.create`, `scroll()` and other scroll driven motion |
| `no-smooth-scroll` | warn | 2.3.3 | `behavior: "smooth"` with no reduced motion fallback |
| `no-autoplay-lottie` | warn | 2.2.2 | A Lottie player starts on load |

### How the numbers are worked out

- **Run time is the total, not one pass.** `duration: 2, repeat: 5` is six passes of two seconds, so twelve seconds of movement. Endless animations are left to `no-infinite-animation` rather than reported twice.
- **Flash rate accounts for reversal.** `yoyo: true`, `repeatType: "reverse"` and `direction: "alternate"` make one light-dark-light cycle take two passes, so the flash rate is half the declared duration. A 200ms alternating fade is 2.5 flashes a second, not 5.
- **A finite repeat can still flash.** WCAG 2.3.1 is about three flashes in any one second, so `duration: 100, iterations: 8` is reported even though it stops.
- **`repeat` counts extra passes, `iterations` counts all of them.** That is what Framer Motion, GSAP and the Web Animations API each mean by their own option, and they are read accordingly.

### One rule ignores your guard on purpose

`no-fast-flash` still reports in a file that checks `prefers-reduced-motion`.

That is deliberate. Most people who are photosensitive have never changed that operating system setting, and a seizure risk is not a preference to respect. Fix the flash rate itself.

## What counts as a guard

A file is treated as guarded when it contains any of these:

- `useReducedMotion`, `usePrefersReducedMotion`, `useMotionPreference`
- an identifier such as `prefersReducedMotion`, `shouldReduceMotion`, `reduceMotion`
- any string containing `prefers-reduced-motion`, which covers `matchMedia`
- a `reducedMotion` prop, which covers `<MotionConfig reducedMotion="user">`

Guards are read from the syntax tree, not from raw text, so none of these silence anything:

- a mention inside a comment
- `<MotionConfig reducedMotion="never">`, which switches the behaviour off rather than on
- `{ reducedMotion: false }` in a settings object
- a type declaration such as `type Options = { reducedMotion: boolean }`
- an `import { useReducedMotion }` that the file never actually calls

## Usage

### Command line

```bash
motion-a11y src                          # lint a folder
motion-a11y src/Hero.tsx                 # lint one file
motion-a11y src --preset strict          # every rule becomes an error
motion-a11y src --rule no-smooth-scroll=off
motion-a11y src --format github          # inline annotations on a pull request
motion-a11y src --format json            # machine readable
motion-a11y src --quiet                  # errors only
motion-a11y src --no-prefilter           # parse every file, even ones with no animation
motion-a11y --rules                      # list every rule
```

Exit code is 1 when there is at least one error, otherwise 0. Use `--max-warnings 0` to fail on warnings too.

### In GitHub Actions

```yaml
- run: npx motion-a11y src --format github
```

### Supported patterns

Beyond the obvious ones, these all resolve:

```js
const tl = gsap.timeline();      // timelines held in a local
tl.to(".a", { duration: 12 });   // ...and the tweens added to them
gsap.timeline().to(".a", {});    // fluent chains
gsap.to(".a", 12, { x: 1 });     // the GSAP 2 duration argument
ScrollTrigger.create({ ... });   // the plugin entry point
<div style={{ scrollBehavior: "smooth" }} />;
<Lottie animationData={data} />; // lottie-react autoplays and loops by default
```

### Programmatic

```js
import { lint } from "motion-a11y";

const result = lint(source, { filename: "Hero.tsx", preset: "strict" });

for (const message of result.messages) {
  console.log(message.line, message.rule, message.message);
}
```

`lint` returns:

```ts
{
  filename: string;
  messages: Message[];
  errorCount: number;
  warningCount: number;
  guarded: boolean;       // did the file check the motion preference
  parseError?: string;    // set instead of throwing
  analysisError?: string; // set instead of throwing, when a parsed file could not be checked
}
```

Neither `lint` nor the CLI throws on a bad file. One unreadable or unparseable
file is reported against that file and the rest of the run continues.

## What it does not do

Being clear about the limits is what makes a linter worth keeping installed.

- **It does not read CSS.** Keyframes and transitions in a stylesheet are covered by [`@double-great/stylelint-a11y`](https://www.npmjs.com/package/@double-great/stylelint-a11y) and its `media-prefers-reduced-motion` rule. Run both tools. They do not overlap.
- **It does not judge whether motion feels comfortable.** Only the mechanical facts: rate, length, repetition, and whether a guard exists.
- **Guards are checked per file, not per branch.** A file with a guard in one function and an unguarded animation in another passes. This keeps false positives low, which matters more for a rule people leave switched on.
- **Values must be literals.** `duration: SPEED` cannot be resolved statically, so it is skipped rather than guessed. TypeScript wrappers are seen through, so `duration: 12 as number` and `behavior: "smooth" as ScrollBehavior` both read fine.
- **Files with no animation marker are not parsed at all.** A file that never mentions `motion`, `gsap`, `lottie`, `animat` or `scroll` cannot produce a finding, so it is skipped before parsing. This is what makes a whole repository cheap to check. The trade-off is that a syntax error in such a file goes unreported; pass `--no-prefilter`, or `{ prefilter: false }`, to parse everything.

## Licence

MIT
