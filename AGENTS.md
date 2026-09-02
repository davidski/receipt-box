# Repository instructions

## Interface components

- Prefer Nuxt UI components over native HTML controls or custom replacements when Nuxt UI provides a suitable element.
- For reported interactive UI bugs, reproduce the exact flow end to end in a browser before declaring it fixed. If browser verification is unavailable, say so explicitly and label visual conclusions as source- or test-level inference.

## Tests and coverage

- Add or update tests whenever behavior changes. Cover successful behavior, boundary cases, and expected failures.
- Run `just test` before considering a change complete.
- Run `just codecov` after changing executable TypeScript or JavaScript. It enforces the repository's minimum coverage thresholds: 95% lines, 85% branches, and 100% functions across modules loaded by the test suite.
- For production TypeScript or JavaScript changes, treat `just test`, `just codecov`, `pnpm typecheck`, and `pnpm build` as one completion gate; focused tests do not replace it.
- Do not lower coverage thresholds, exclude relevant files, or weaken assertions merely to make a check pass. If a threshold genuinely needs adjustment, explain the reason and obtain approval first.
- A passing coverage percentage is not a substitute for meaningful assertions. Prefer tests that verify observable behavior and regression cases.
- Run `pnpm typecheck` and `pnpm build` after changes that can affect compilation or production output.
