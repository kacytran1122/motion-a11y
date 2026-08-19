# Changelog

This project follows [semantic versioning](https://semver.org). While the major
version is `0`, a minor bump may contain a breaking change.

## 0.2.3

### Documentation

- Made the opening explanation easier for non-technical readers to understand.
- Removed all em dashes from the README text.

## 0.2.2

### Documentation

- Removed the npm downloads badge so the README shows only the requested npm
  version, CI, TypeScript, Node, and MIT License badges.

## 0.2.1

### Documentation

- Rewrote the npm README in plain language so people without an accessibility
  or technical background can understand why safer animation matters.

## 0.2.0

### Breaking

- **A file that cannot be parsed now fails the run.** Previously the CLI printed
  the parse error and still exited `0`, so a file the linter never checked
  looked like a file that passed. This matches how ESLint treats a parse error.
  Pass `--allow-unchecked` to keep the old behaviour.
- **`LintResult` gained a required `suppressedCount` field.** Only relevant if
  you construct a `LintResult` yourself; reading one is unaffected.
- More code is detected than before, so a project upgrading may see new
  findings. See "Detection" below.

### Added

- **Inline suppression comments**, in the shapes ESLint uses:
  `// motion-a11y-disable-next-line`, `// motion-a11y-disable-line`, and
  `/* motion-a11y-disable */` … `/* motion-a11y-enable */`. A bare directive
  covers every rule; naming rules after it covers only those.
- **Ignore support**: a `.motion-a11yignore` file and a repeatable `--ignore`
  flag, with gitignore-style patterns (`dist/`, `src/generated/**`, `*.gen.ts`).
  Negation (`!`) is rejected rather than silently dropped.
- **Config files**: `motion-a11y.config.json`, `.motion-a11yrc.json`, or a
  `motion-a11y` key in `package.json`. JSON only, so a config file cannot
  execute code. Unknown keys are an error rather than silently ignored.
  Command line options win over the file; `--no-config` ignores it entirely.
- `--config <path>` and `--allow-unchecked` flags.
- `lintAst(ast, source, options)` for callers that have already parsed the file.
- `LintResult.analysisError`, set when a parsed file could not be checked, so a
  single bad file can no longer take down a whole run.
- `LintResult.suppressedCount`.

### Detection

- **Optional chaining is now seen.** `ref.current?.animate(...)`,
  `gsap?.to(...)` and `el?.scrollIntoView({ behavior: "smooth" })` previously
  produced no findings at all. This was the largest false-negative class, since
  `ref.current?.animate(...)` is the ordinary way to reach the Web Animations
  API from React.
- Call options wrapped in `as T` or `satisfies T` are read.
- GSAP timelines held in a local (`const tl = gsap.timeline(); tl.to(...)`),
  fluent chains, and the GSAP 2 `gsap.to(target, duration, vars)` form.
- `ScrollTrigger.create(...)` and `ScrollSmoother.create(...)`.
- `scrollBehavior: "smooth"` in a style object.
- `lottie-react`, which autoplays and loops unless told otherwise.

### Fixed

- **The CLI truncated its output at 64 KB when piped.** `process.exit()` ran
  before stdout flushed, so `--format json > out.json` produced invalid JSON on
  any real project.
- `formatPretty` reported "No animation accessibility problems found" for a run
  where a file failed to parse.
- GitHub annotations did not escape `%`, newlines, or commas and colons in
  property values, so messages and filenames were silently mangled.
- `rules: { "some-rule": undefined }` promoted that rule to `error` instead of
  leaving the preset value alone. An invalid `preset` did the same to every rule.
- `<MotionConfig reducedMotion="never">`, `{ reducedMotion: false }`, a type
  declaration mentioning `reducedMotion`, and an unused
  `import { useReducedMotion }` were all treated as reduced-motion guards, which
  silenced every rule in the file.
- `{ paused: false }` counted as a pause control.
- Any element named `<Player>` was treated as a Lottie player.
- `no-long-animation` measured one pass rather than the total run time, so
  `duration: 2, repeat: 5` (twelve seconds of motion) went unreported.
- `no-fast-flash` ignored finite repeats (`iterations: 8` at 100 ms is eight
  flashes a second) and ignored reversal, reporting `yoyo`/`repeatType:
"reverse"`/`direction: "alternate"` at twice their real flash rate.
- The CLI accepted a non-numeric `--max-warnings` and then never enforced it,
  matched zero files when `--ext` was the last argument, crashed on an unreadable
  file, linted the same file twice for overlapping arguments, and skipped
  symlinked source directories.

### Security

- The glob compiler normalises runs of `*` before building a regular expression.
  A checked-in `.motion-a11yignore` is written by whoever opened the pull
  request, and a pattern such as `"*" * 200 + "x"` previously compiled to
  adjacent unbounded quantifiers that backtracked exponentially, hanging the
  run. Pattern length is also capped.
- Config is JSON only; there is no code-executing config format.
- Dev toolchain moved off Vite/Vitest, clearing all six advisories
  (2 critical, 1 high, 3 moderate) that came in through that dependency tree.

### Performance

Measured on a 500-file / 747 KB corpus, best of three alternating runs:

| Metric                   | 0.1.0     | 0.2.0    | Change |
| ------------------------ | --------- | -------- | ------ |
| 500-file corpus          | 70.97 ms  | 21.60 ms | 3.29x  |
| Same, prefilter disabled | 70.97 ms  | 38.20 ms | 1.86x  |
| Single 1.24 MB file      | 194.79 ms | 87.74 ms | 2.22x  |
| Cost per KB at 3.2 MB    | 107.78 us | 50.11 us | 2.15x  |
| Peak RSS over 2000 files | 298.2 MB  | 221.7 MB | 1.35x  |

- Files containing no animation marker are no longer parsed at all, which is
  where most of the wall-clock win comes from on a real repository.
- Collection walks the AST once instead of three times, and no longer allocates
  a visited set per file. Scaling went from super-linear to flat.
- Positions come from the parser rather than a separate line index.

## 0.1.0

Initial release.
