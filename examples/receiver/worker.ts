import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { importAuditEvent, inspectDate, type AuditInput, type IsoParser } from "./audit-importer.js";

const module = await import(pathToFileURL(process.argv[2]).href);
const original = module.parseISO as IsoParser;
const parse: IsoParser = process.argv[3] === "collapse-invalid" ? (text, options) => {
  const value = original(text, options);
  return Number.isNaN(value.getTime()) ? new Date(0) : value;
} : original;
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const request = JSON.parse(line) as { id: string; input: AuditInput };
  let outcome;
  try {
    const input = request.input;
    if (typeof input.text !== "string" || typeof input.eventId !== "string" || (input.additionalDigits !== undefined && ![0, 1, 2].includes(input.additionalDigits))) throw new TypeError("Input violates iso-parser contract");
    const date = parse(input.text, { additionalDigits: input.additionalDigits });
    outcome = { kind: "value", value: { parser: inspectDate(date), host: importAuditEvent(input, parse) } };
  } catch (error) {
    outcome = { kind: "thrown", name: (error as Error).name, message: (error as Error).message };
  }
  process.stdout.write(JSON.stringify({ id: request.id, outcome }) + "\n");
}
