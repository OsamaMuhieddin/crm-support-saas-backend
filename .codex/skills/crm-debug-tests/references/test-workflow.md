# Test Workflow

## Test stack

- Test runner: Jest
- HTTP endpoint tests commonly use `supertest`
- Many service tests use direct model mocking with `jest.spyOn`
- The project test script runs Jest in band

## Useful commands

- `npm test`
- `npm test -- tests/workspaces.switch.test.js`
- `npm test -- --runTestsByPath tests/tickets.core.test.js`
- `npm test -- -t "Workspace switching"`

## Practical strategy

1. Start with the most specific affected test file.
2. If the bug is in service logic, inspect nearby service tests first.
3. If the bug is in routing, auth, or response shape, inspect endpoint tests first.
4. If the bug involves locale keys, run the locale or validation-key tests.
5. If the bug involves realtime behavior, prefer the dedicated realtime suites and use the manual smoke test only when needed.

## Repo patterns

- Endpoint suites live broadly under `tests/*.test.js`
- Service-level suites also live under `tests/*.service.test.js`
- Realtime has both automated suites and `tests/manual/realtime-smoke-test.js`
- There are dedicated tests for locale integrity and validation keys

## Implementation rules

- When changing behavior, add or update the nearest targeted regression test in the same area.
- Prefer one focused test that proves the invariant over broad snapshot-like coverage.
- Keep test setup aligned with existing suite style instead of inventing a new helper pattern for one case.
- Use full-suite runs only when the change is broad, shared, or the failure surface remains unclear after targeted runs.
