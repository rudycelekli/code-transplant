import { spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import type { CommandSpec, Context, Execution, Outcome, TestCase } from "../domain/index.js";
import { canonicalJson, hashJson } from "../domain/index.js";

export function isOutcome(value: unknown): value is Outcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const outcome = value as Record<string, unknown>;
  if (outcome.kind === "thrown") return typeof outcome.name === "string" && typeof outcome.message === "string" && Object.keys(outcome).length === 3;
  if (outcome.kind !== "value" || !("value" in outcome) || Object.keys(outcome).length !== 2) return false;
  try { canonicalJson(outcome.value); return true; } catch { return false; }
}

export async function runCommand(command: CommandSpec, cases: TestCase[], context: Context,
  limits: { timeoutMs: number; maxOutputBytes: number; maxInputBytes: number }, executionRoot?: string): Promise<Execution> {
  const result: Execution = { command, commandDigest: hashJson(command), context: context.name, completed: false, outcomes: Object.create(null) };
  const requests = cases.map(test => canonicalJson({ id: test.id, input: test.input }) + "\n").join("");
  if (Buffer.byteLength(requests) > limits.maxInputBytes) return { ...result, error: "Input byte limit exceeded" };
  if (!Array.isArray(command.argv) || command.argv.length === 0 || command.argv.some(arg => typeof arg !== "string" || arg.includes("\0"))) return { ...result, error: "Command requires an argv array of strings" };
  const wanted = new Set(cases.map(test => test.id));
  return new Promise(resolve => {
    const child = spawn(command.argv[0] === "node" ? process.execPath : command.argv[0], command.argv.slice(1), {
      cwd: executionRoot ? resolvePath(executionRoot, command.cwd ?? ".") : command.cwd, env: { ...process.env, ...command.env, ...context.env },
      shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
    });
    let pending = "", outputBytes = 0, stderrBytes = 0, finished = false;
    let fault: string | undefined;
    const stop = (error: string) => {
      fault ??= error;
      try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* already exited */ }
    };
    const timer = setTimeout(() => stop("Process timeout exceeded"), limits.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > limits.maxOutputBytes) { stop("Output byte limit exceeded"); return; }
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1 && !fault) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        try {
          const response: unknown = JSON.parse(line);
          if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("Response must be an object");
          const record = response as Record<string, unknown>;
          if (Object.keys(record).length !== 2 || typeof record.id !== "string" || !wanted.has(record.id) || !isOutcome(record.outcome)) throw new Error("Invalid response envelope or outcome");
          if (Object.hasOwn(result.outcomes, record.id)) throw new Error("Duplicate response id");
          result.outcomes[record.id] = record.outcome;
        } catch (error) { stop("Invalid JSONL protocol: " + (error as Error).message); }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.byteLength; if (stderrBytes > 65536) stop("Stderr byte limit exceeded"); });
    child.stdin.on("error", () => { /* close/nonzero checks determine completion */ });
    child.once("error", error => stop("Process launch failed: " + error.message));
    child.once("close", (code, signal) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (!fault && code !== 0) fault = `Process exited unsuccessfully (${code ?? signal})`;
      if (!fault && pending.length !== 0) fault = "JSONL response missing final newline";
      if (!fault && Object.keys(result.outcomes).length !== cases.length) fault = "Missing responses";
      if (fault) result.error = fault; else result.completed = true;
      resolve(result);
    });
    child.stdin.end(requests);
  });
}
