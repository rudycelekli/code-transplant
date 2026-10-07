# Audit importer host example

This newly created program accepts a parser through an explicit TypeScript interface. It has no dependency on the date-fns package and no imports from donor source. The demo supplies the generated capsule at runtime; the reference worker supplies the separately compiled untouched donor.

Both workers expose parser observations and the host's acceptance/event payload through JSONL. Dates without offsets retain the upstream local-timezone semantics. Invalid Date values cause rejection by the host. Custom Date constructors and `options.in` are outside the first contract.

This is an example host, not a claim that a feature has already been integrated into a second mature upstream program.
