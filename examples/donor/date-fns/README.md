# Pinned donor

Source: [date-fns v4.1.0](https://github.com/date-fns/date-fns/tree/313b902b9a72c64501074db9bc2b9897d2db5140), commit `313b902b9a72c64501074db9bc2b9897d2db5140`.

The seven files under `src` are byte-for-byte upstream source. They contain the complete module dependency closure needed to independently compile `parseISO`, including its broad type modules. `provenance.json` records original paths and SHA-256 hashes; the MIT license is preserved in `LICENSE`.

`upstream-tests/parseISO.test.ts` is retained untouched as an inspectable source of upstream edge cases. The demo's standalone differential corpus includes the ordinary Date cases and additional generated cases. It does not execute the upstream Vitest suite or its Date-extension tests.
