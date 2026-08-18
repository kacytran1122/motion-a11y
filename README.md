# motion-a11y

**Finds animations on your site that can make people dizzy or sick — before you ship them.**

[![CI](https://github.com/kacytran1122/motion-a11y/actions/workflows/ci.yml/badge.svg)](https://github.com/kacytran1122/motion-a11y/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A518-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Try it right now. You don't need to install anything first:

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

## Why you might want this

Some animations don't just look bad — they hurt people.

- **Dizziness.** About 35 out of every 100 adults over 40 have an inner-ear problem that makes motion on screen uncomfortable. A parallax hero or a smooth scroll can leave them nauseous for hours. They usually just close the tab and never tell you.
- **Seizures.** Anything that flashes more than 3 times a second can trigger one. That is a hard limit in the accessibility rules (WCAG 2.3.1), not a suggestion.

Both are easy to ship by accident. Both are easy for a computer to spot.

## Why your current tools miss it

You may already run an accessibility checker. None of them look where your animations live:

| Tool                     | What it reads     | Why it misses animations                                |
| ------------------------ | ----------------- | ------------------------------------------------------- |
| `eslint-plugin-jsx-a11y` | JSX attributes    | Can't see a GSAP timeline written in plain JavaScript   |
| `stylelint-a11y`         | CSS               | Can't see `repeat: Infinity` inside a JavaScript object |
| `axe-core`               | The rendered page | Can't see an animation that hasn't started yet          |

`motion-a11y` reads your JavaScript and TypeScript. That's where Framer Motion, Motion, GSAP, Lottie, and the Web Animations API actually live.

It doesn't replace those tools. Run it alongside them — they don't overlap.

## Install

```bash
npm install --save-dev motion-a11y
```

You need Node 18 or newer. It pulls in one package, `@babel/parser`, and nothing else.

## The seven rules

An **error** fails the check. A **warn** is reported but doesn't fail it.

| Rule                           | Level | WCAG  | What it catches                                                            |
| ------------------------------ | ----- | ----- | -------------------------------------------------------------------------- |
| `require-reduced-motion-guard` | error | 2.3.3 | The file animates but never asks whether the visitor wants less motion     |
| `no-infinite-animation`        | error | 2.2.2 | Motion that repeats forever with no way to stop it                         |
| `no-fast-flash`                | error | 2.3.1 | Something flashes or changes colour more than 3 times a second             |
| `no-long-animation`            | warn  | 2.2.2 | Motion that runs over 5 seconds with no way to pause it                    |
| `no-scroll-linked-animation`   | warn  | 2.3.3 | Motion tied to scrolling, such as `useScroll` or `ScrollTrigger.create`    |
| `no-smooth-scroll`             | warn  | 2.3.3 | `behavior: "smooth"` with no fallback for people who asked for less motion |
| `no-autoplay-lottie`           | warn  | 2.2.2 | A Lottie animation that starts playing the moment the page loads           |

Every rule points at a published WCAG rule. So a finding is a standard you can show your team, not a matter of taste.

Two presets are built in. `recommended` is the default and mixes errors and warnings, as in the table above. `strict` turns every rule into an error. You can also change any single rule yourself.

### How the timings are worked out

- **Length means total time, not one pass.** `duration: 2, repeat: 5` runs six times, so that's 12 seconds of movement, not 2.
- **Animations that reverse flash half as fast.** With `yoyo: true`, `repeatType: "reverse"`, or `direction: "alternate"`, one light-dark-light cycle takes two passes. So a 200ms fade that alternates is 2.5 flashes a second, not 5.
- **Something that stops can still flash too fast.** The rule is 3 flashes in any single second, so `duration: 100, iterations: 8` is reported even though it ends.
- **`repeat` and `iterations` are counted differently, on purpose.** `repeat` means extra passes; `iterations` means all of them. That's what Framer Motion, GSAP, and the Web Animations API each mean by their own option.

### One rule ignores your reduced motion check

Every rule goes quiet once a file respects the visitor's motion setting — except `no-fast-flash`.

That's deliberate. Most people who are sensitive to flashing have never turned that setting on, and many don't know it exists. A seizure risk isn't a preference to honour. So the rule asks you to fix the flash rate itself rather than hide it behind a setting.

If you disagree about a specific line, switch the rule off there explicitly. Then it's a decision somebody made and can be reviewed.

## Turning off a warning you don't want

Any linter without an escape hatch gets switched off entirely the first time it's wrong. So there's one. The comments look the same as ESLint's:

```js
// motion-a11y-disable-next-line
gsap.to(".a", { repeat: -1 });

// motion-a11y-disable-next-line no-infinite-animation, no-long-animation
gsap.to(".b", { repeat: -1, duration: 12 });

gsap.to(".c", { repeat: -1 }); // motion-a11y-disable-line

/* motion-a11y-disable */
// nothing from here down is checked
/* motion-a11y-enable */
```

A plain comment turns off every rule for that line. Naming rules after it turns off only those. Findings you silenced are still counted, under `suppressedCount`, so nothing disappears without a trace.

This works for `no-fast-flash` too, even though a reduced motion check can't silence it. A comment on one line is a decision somebody reviewed. A visitor's system setting is not.

## Skipping whole files

Put patterns in a `.motion-a11yignore` file, or pass `--ignore` (you can use it more than once):

```
# .motion-a11yignore
dist/
src/generated/**
*.gen.ts
```

Patterns work the way `.gitignore` does. A plain name matches any folder or file with that name. A trailing slash means folders only, and covers everything inside. `*` stays inside one part of the path, and `**` crosses into subfolders.

You can't use `!` to un-ignore something. If you try, you get a clear error instead of silence.

## Settings

Settings can go in `motion-a11y.config.json`, `.motion-a11yrc.json`, or a `motion-a11y` key in your `package.json`:

```json
{
  "preset": "strict",
  "rules": { "no-smooth-scroll": "off" },
  "ignore": ["src/generated/**"],
  "maxWarnings": 0
}
```

It's JSON only, on purpose. A settings file that can run code is a security risk for a tool people run in CI over code they just downloaded — and nothing here needs to be calculated.

A key it doesn't recognise is an error, not a silent no-op, so a typo can't quietly disable a rule. Command line options beat the file, and `--no-config` ignores the file completely.

## What counts as checking the motion setting

A file passes `require-reduced-motion-guard` if it contains any of these:

- `useReducedMotion`, `usePrefersReducedMotion`, or `useMotionPreference`
- a variable named something like `prefersReducedMotion`, `shouldReduceMotion`, or `reduceMotion`
- any text containing `prefers-reduced-motion`, which covers `matchMedia`
- a `reducedMotion` prop, which covers `<MotionConfig reducedMotion="user">`

These are read from the actual code structure, not by searching the text. So none of the following will fool it:

- a mention inside a comment
- `<MotionConfig reducedMotion="never">`, which turns the behaviour off rather than on
- `{ reducedMotion: false }` in a settings object
- a type definition such as `type Options = { reducedMotion: boolean }`
- importing `useReducedMotion` but never calling it

## How to run it

### From the command line

```bash
motion-a11y src                          # check a folder
motion-a11y src/Hero.tsx                 # check one file
motion-a11y src --preset strict          # make every rule an error
motion-a11y src --rule no-smooth-scroll=off
motion-a11y src --format github          # comments appear inline on a pull request
motion-a11y src --format json            # output for other programs to read
motion-a11y src --quiet                  # errors only, hide warnings
motion-a11y src --ignore "src/generated/**"
motion-a11y src --no-prefilter           # read every file, even ones with no animation
motion-a11y src --allow-unchecked        # don't fail on files that can't be read
motion-a11y --rules                      # print the list of rules
```

It skips `node_modules` and build output on its own.

### What the exit codes mean

| Code | Meaning                                                                                |
| ---- | -------------------------------------------------------------------------------------- |
| 0    | Nothing to report                                                                      |
| 1    | At least one error, too many warnings for `--max-warnings`, or a file it couldn't read |
| 2    | You used it wrong: an unknown option, a missing path, or a broken settings file        |

A file it can't read **fails the run**, the same way ESLint treats a broken file. A checker that reports success for a file it never opened is how a problem slips past CI. Add `--allow-unchecked` if you'd rather it just tell you.

### In GitHub Actions

```yaml
- run: npx motion-a11y src --format github
```

Each finding shows up as a comment on the exact line of the diff, so reviewers see it without opening the log.

### From your own code

```js
import { lint } from "motion-a11y";

const result = lint(source, { filename: "Hero.tsx", preset: "strict" });

for (const message of result.messages) {
  console.log(message.line, message.rule, message.message);
}
```

`lint` gives you back:

```ts
{
  filename: string;
  messages: Message[];
  errorCount: number;
  warningCount: number;
  suppressedCount: number; // findings that a disable comment silenced
  guarded: boolean;        // did the file check the motion setting?
  parseError?: string;     // set if the file couldn't be read, instead of crashing
  analysisError?: string;  // set if the file was read but couldn't be checked
}
```

Neither `lint` nor the command line tool ever crashes on a bad file. One broken file is reported against that file, and the rest of the run carries on.

Already parsed the file with `@babel/parser`? Use `lintAst(ast, source, options)` to skip the second parse and get the same result.

TypeScript types are included, and it works with both `import` and `require`.

### Unusual code it still understands

```js
ref.current?.animate(frames, opts); // optional chaining, the normal React way
const tl = gsap.timeline(); // a timeline stored in a variable
tl.to(".a", { duration: 12 }); // ...and the tweens added to it later
gsap.timeline().to(".a", {}); // chained calls
gsap.to(".a", 12, { x: 1 }); // the older GSAP 2 style
ScrollTrigger.create({ ... }); // the plugin entry point
el.scrollIntoView({ behavior: "smooth" as ScrollBehavior }); // TypeScript wrappers
<div style={{ scrollBehavior: "smooth" }} />;
<Lottie animationData={data} />; // lottie-react loops and autoplays by default
```

## What it can't do

Being clear about the limits is what makes a checker worth keeping installed.

- **It doesn't read CSS.** Animations written in a stylesheet are [`@double-great/stylelint-a11y`](https://www.npmjs.com/package/@double-great/stylelint-a11y)'s job, with its `media-prefers-reduced-motion` rule. Run both tools.
- **It doesn't judge whether an animation feels nice.** Only the measurable facts: how fast, how long, how often, and whether you checked the motion setting. Whether it feels comfortable is a human call.
- **It checks per file, not per function.** A file with a motion check in one function and an unguarded animation in another will pass. That's a deliberate trade: false alarms are the fastest way to get a checker switched off, and a checker nobody runs finds nothing.
- **Numbers have to be written out.** `duration: SPEED` can't be worked out without running your code, so it's skipped rather than guessed at. TypeScript wrappers are seen through, so `duration: 12 as number` reads fine.
- **Files with no sign of animation are skipped entirely.** A file that never mentions `motion`, `gsap`, `lottie`, `animat`, or `scroll` can't produce a finding, so it isn't opened. That's what makes checking a whole project fast. The trade-off: a syntax error in such a file goes unreported. Use `--no-prefilter`, or `{ prefilter: false }`, to read everything.

## Licence

MIT
