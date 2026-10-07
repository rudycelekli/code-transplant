# Contributing

Start with `npm ci` and `npm run check` on Node 22 or newer. Use a small parser
fixture when extending extraction. Include a refusal fixture for every newly
supported syntax or dependency boundary, and run the real donor proof before
proposing a change. Add an ADR describing the change and the checks performed.

Useful contributions include independent TypeScript parser donor/host pairs,
smaller mismatch witnesses, detection of mutable state and effects, and replay
of capsules against a newer donor revision. Keep source licenses and provenance.
Do not submit private company code, credentials, or unsupported claims of
behavioral equivalence. Report observed inputs, environments, and outcomes.

The initial importer is an example receiving application. A transplant into a
second mature, unrelated open-source host is the next external validation target.
