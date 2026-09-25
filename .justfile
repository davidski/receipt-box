test:
    pnpm test

# Run the coverage gate used by pre-commit.
codecov:
    pnpm test:coverage

check: test codecov
    pnpm typecheck
    pnpm build
