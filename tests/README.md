# Verification boundaries

- core.test.mjs: pure validation, no Executor needed.
- integration.mjs: real official beta runtime, fresh synthetic app and data, actual MCP calls and service restart. No mocked workflow engine or SQL implementation.
- Programmatic accept/decline in the suite is permitted only for its synthetic notes. This tests plumbing, never constitutes or proves human approval.
- The runtime may report either running or waiting while a durable sleep is active. The test asserts it remains active without an approval error, survives restart, and subsequently completes after review.
