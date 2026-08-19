# motion-a11y

**Make animations safer before someone gets hurt.**

[![npm version](https://img.shields.io/npm/v/motion-a11y.svg)]
(https://www.npmjs.com/package/motion-a11y)
[![CI](https://github.com/kacytran1122/motion-a11y/actions/workflows/ci.yml/badge.svg)](https://github.com/kacytran1122/motion-a11y/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A518-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Animation can make a website feel polished. It can also make some visitors
dizzy, nauseous, disoriented, or—in the case of fast flashing—put them at risk
of a seizure.

Most teams do not mean to create these problems. They are simply hard to spot
while building.

`motion-a11y` reads the animation code before the website goes live and points
to patterns that need attention.

[View motion-a11y on npm](https://www.npmjs.com/package/motion-a11y)

## Try it in one command

You do not need to install anything first:

```bash
npx motion-a11y src
```

Example result:

```text
src/Hero.tsx
  5:31  warn   This animation follows the scroll position but does not offer
                a reduced-motion option.
  9:7   error  This element flashes more than 3 times per second.
 14:7   error  This animation repeats forever with no pause control.

2 errors, 1 warning
```

The result tells you the file, the line, what is wrong, and which accessibility
rule it relates to.

## Who is this for?

- Product teams that use animation on websites or web apps.
- Developers using Framer Motion, Motion, GSAP, Lottie, or the browser's
  animation tools.
- Accessibility teams that want animation checks in the normal release
  process.
- Agencies that need the same safety rules across many client projects.

It works alongside tools such as `axe-core` and `eslint-plugin-jsx-a11y`.
Those tools check other parts of accessibility; they usually do not understand
animation timelines written in JavaScript.

## What it looks for

| Everyday problem                                                 | What the tool reports                              |
| ---------------------------------------------------------------- | -------------------------------------------------- |
| A visitor asks for less motion, but the page ignores the request | Missing reduced-motion support                     |
| An animation never stops                                         | An endless animation with no pause control         |
| Something flashes too quickly                                    | More than 3 flashes per second                     |
| Motion continues for a long time                                 | More than 5 seconds with no pause control          |
| The page moves as the visitor scrolls                            | Scroll-linked motion with no reduced-motion option |
| Clicking a link forces a smooth scroll                           | Smooth scrolling with no fallback                  |
| A Lottie animation starts by itself                              | Autoplay that may surprise or distract the visitor |

These checks map to seven named rules:

| Rule                           | Default result | Standard   |
| ------------------------------ | -------------- | ---------- |
| `require-reduced-motion-guard` | error          | WCAG 2.3.3 |
| `no-infinite-animation`        | error          | WCAG 2.2.2 |
| `no-fast-flash`                | error          | WCAG 2.3.1 |
| `no-long-animation`            | warning        | WCAG 2.2.2 |
| `no-scroll-linked-animation`   | warning        | WCAG 2.3.3 |
| `no-smooth-scroll`             | warning        | WCAG 2.3.3 |
| `no-autoplay-lottie`           | warning        | WCAG 2.2.2 |

An **error** fails the command. A **warning** is shown but does not fail it
unless you set a warning limit. The `strict` preset treats every rule as an
error.

Fast flashing is always checked. A reduced-motion setting does not make unsafe
flashing safe, because many people at risk have never enabled that setting.

## Install it in a project

```bash
npm install --save-dev motion-a11y
```

Node 18 or newer is required. The published package has one runtime dependency:
`@babel/parser`.

Add a script to `package.json`:

```json
{
  "scripts": {
    "check:motion": "motion-a11y src"
  }
}
```

Then run:

```bash
npm run check:motion
```

## Put it in GitHub Actions

```yaml
- run: npx motion-a11y src --format github
```

Each problem appears on the matching line in the pull request. A serious
problem makes the workflow fail, so it cannot be missed in a long build log.

## Common commands

```bash
motion-a11y src                         # check a folder
motion-a11y src/Hero.tsx                # check one file
motion-a11y src --preset strict         # make every finding an error
motion-a11y src --format github         # GitHub pull-request comments
motion-a11y src --format json           # output for another program
motion-a11y src --quiet                 # show errors only
motion-a11y src --ignore "src/demo/**"  # skip files you choose
motion-a11y --rules                     # list all seven rules
```

Exit codes are simple:

| Code | Meaning                                                                |
| ---: | ---------------------------------------------------------------------- |
|    0 | No blocking problem was found                                          |
|    1 | A blocking problem, too many warnings, or an unreadable file was found |
|    2 | The command or settings were invalid                                   |

The tool skips `node_modules`, build output, and files with no sign of animation
code.

## Change the settings

Create `motion-a11y.config.json`:

```json
{
  "preset": "recommended",
  "rules": {
    "no-smooth-scroll": "off",
    "no-long-animation": "error"
  },
  "ignore": ["src/generated/**"],
  "maxWarnings": 0
}
```

Settings can also live in `.motion-a11yrc.json` or under a `motion-a11y` key in
your `package.json`. Unknown settings are rejected, so a spelling mistake
cannot quietly turn a check off.

## When a warning is intentional

Sometimes an animation is a deliberate exception. Leave a short comment beside
the code so the decision is visible during review:

```js
// motion-a11y-disable-next-line no-infinite-animation
gsap.to(".spinner", { repeat: -1 });
```

To skip generated or example files, add a `.motion-a11yignore` file:

```gitignore
dist/
src/generated/**
*.gen.ts
```

Disabled findings are counted in the result. They do not silently disappear.

## Use it from JavaScript

```js
import { lint } from "motion-a11y";

const result = lint(sourceCode, {
  filename: "Hero.tsx",
  preset: "strict",
});

for (const problem of result.messages) {
  console.log(problem.line, problem.rule, problem.message);
}
```

The result includes error, warning, and suppressed counts. A file that cannot
be read returns a clear error in the result instead of crashing the whole run.
TypeScript types, ESM, and CommonJS are included.

## How it works

The tool reads the structure of JavaScript and TypeScript. It does not run your
website, upload your code, watch visitors, or send analytics.

It understands common patterns from:

- Framer Motion and Motion;
- GSAP timelines and ScrollTrigger;
- Lottie and lottie-react;
- the Web Animations API;
- `scrollIntoView` and JavaScript style objects.

It calculates total run time, repeat counts, reverse animations, and flash
rates from numbers written directly in the code.

## What it cannot promise

This is an early warning system, not a certificate that every animation is
comfortable for every person.

- It does not read CSS animations. Use a CSS accessibility checker alongside it.
- It measures facts such as speed, length, repetition, and missing controls. It
  cannot decide whether an animation feels pleasant.
- It checks each file as a whole. A reduced-motion check in one part of a file
  may cover animation elsewhere in that file.
- It cannot calculate a value hidden behind a variable such as
  `duration: SPEED` without running the code, so it does not guess.
- Human testing still matters, especially for large movement, zooming, and
  unusual visual effects.

## Contributing

```bash
npm ci
npm run verify
```

The verification command checks types, style, tests, coverage, package exports,
security, and the built command-line tool.

## Licence

MIT. Use it for personal or commercial projects.
