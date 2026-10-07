# Behavioral verification boundary

`verifyBehavior` sends `{id,input}` JSONL requests to explicitly selected commands and requires exactly one `{id,outcome}` JSONL response per case. Outcomes are `{kind:"value",value:<finite JSON>}` or `{kind:"thrown",name,message}`. Process failures are evidence failures; two processes failing alike do not establish agreement.

Commands use argv arrays with `shell:false`. The literal executable `node` resolves to the verifier's own Node runtime; version, platform and architecture are recorded. `executionRoot` resolves relative command working directories and evidence paths without publishing the user's machine-local project path. Other executable names use ordinary process resolution.

Input, output, stderr, corpus and context sizes are bounded. A deadline terminates the process group on Unix, including children that retain inherited pipes. These are trusted-code subprocesses, not security sandboxes.

The report records every outcome, declared command digest, context, case input, source binding hash, mismatch and semantic negative control. Bound file hashes are checked before and after execution. A control counts as detected only if it runs successfully and disagrees with the reference on a recorded case.

`verifyReport` checks the canonical SHA-256 digest and recomputes main and control comparisons from outcomes. It checks an internally consistent record offline. An unkeyed hash is not an authenticated signature, and someone can author a completely different internally consistent report. The report does not prove universal equivalence, correctness against a specification, or that source remained unchanged at every instant during execution.
