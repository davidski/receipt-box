# Repository instructions

## Tests and coverage

- Add or update tests whenever behavior changes. Cover successful behavior, boundary cases, and expected failures.
- Run `just test` before considering a change complete.
- Run `just codecov` after changing executable TypeScript or JavaScript. It enforces the repository's minimum coverage thresholds: 95% lines, 85% branches, and 100% functions across modules loaded by the test suite.
- Do not lower coverage thresholds, exclude relevant files, or weaken assertions merely to make a check pass. If a threshold genuinely needs adjustment, explain the reason and obtain approval first.
- A passing coverage percentage is not a substitute for meaningful assertions. Prefer tests that verify observable behavior and regression cases.
- Run `pnpm typecheck` and `pnpm build` after changes that can affect compilation or production output.
