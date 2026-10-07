/** A small independent host example. It consumes a parser port, not date-fns. */
export interface IsoParser {
  (text: string, options?: { additionalDigits?: 0 | 1 | 2 }): Date;
}
export interface AuditInput { text: string; additionalDigits?: 0 | 1 | 2; eventId: string }
export function importAuditEvent(input: AuditInput, parseTimestamp: IsoParser) {
  const date = parseTimestamp(input.text, { additionalDigits: input.additionalDigits });
  if (Number.isNaN(date.getTime())) return { accepted: false, error: { code: "INVALID_TIMESTAMP", text: input.text } };
  return { accepted: true, event: { id: input.eventId, occurredAtEpochMs: date.getTime(), occurredAtIso: date.toISOString() } };
}
export function inspectDate(date: Date) {
  if (Number.isNaN(date.getTime())) return { valid: false, epochMs: null, localParts: null };
  return { valid: true, epochMs: date.getTime(), localParts: [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()] };
}
