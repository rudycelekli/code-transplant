import type { TestCase } from "../domain/index.js";

/** Deterministic grammar-based corpus, plus targeted upstream semantic boundaries. */
export function isoParserCorpus(seed = 0x5eedc0de): TestCase[] {
  const cases: TestCase[] = [];
  const add = (text: string, category: string, additionalDigits?: 0 | 1 | 2) => {
    const id = "iso-" + String(cases.length).padStart(4, "0");
    cases.push({ id, category, input: { text, eventId: id, ...(additionalDigits !== undefined ? { additionalDigits } : {}) } });
  };
  const edges: Record<string, string[]> = {
    partial: ["2014", "2014-02", "201402", "20", "2014-02-11", "20140211", "0000-01-01", "0099-12-31"],
    ordinal: ["2014-039", "2014039", "2000-366", "1900-366", "2100-366", "2004-000", "2004-367"],
    week: ["2014-W02", "2014W02", "2014-W02-7", "2014W027", "2015-W53-7", "2019-W53-7", "2014-W00-1", "2014-W54-1", "2014-W01-0", "2014-W01-8"],
    leap: ["1900-02-29", "2000-02-29", "2100-02-29", "2004-02-29", "2014-02-30", "2014-04-31"],
    time: ["2014-02-11T11", "2014-02-11T1130", "2014-02-11T11:30:30.123456", "2014-02-11T11,5", "2014-02-11T11:30,5", "2014-02-11T11:30:30,5", "2014-02-11T24:00", "2014-02-11T24:00:00.001", "2014-02-11T23:59:60", "2014-02-11T25:00", "2014-02-11T11:60"],
    offset: ["2014-02-11T11:30:30Z", "2014-02-11T11:30:30+01:00", "2014-02-11T11:30:30-01:00", "2014-02-11T11:30+0545", "2014-02-11T11:30-03", "2014-02-11T11:30+99:59", "2014-02-11T11:30+02:60", "2014-02-11T11:30Zjunk", "2014-02-11T11:30z", "2014-02-11Z"],
    dst: ["2024-03-10T01:59:59", "2024-03-10T02:30:00", "2024-03-10T03:00:00", "2024-11-03T01:30:00", "2024-11-03T02:00:00"],
    malformed: ["", " ", "not-a-date", "2014-00-01", "2014-13-01", "2014-01-00", "2014-01-32", "2014-02-11T", "2014-02-11T11:30:30T12", "2014-02-11 11:30:30", "2014-02-11\n", "２０１４-02-11", "11:30:30", "2014-02-11T11:30:30+oops"],
    range: ["+275760-09-13T00:00:00Z", "+275760-09-13T00:00:00.001Z", "-271821-04-20T00:00:00Z", "-271821-04-19T23:59:59Z", "+999999-01-01", "-999999-01-01"],
  };
  for (const [category, texts] of Object.entries(edges)) for (const text of texts) add(text, category);
  for (const digits of [0, 1, 2] as const) for (const text of ["+2014-02-11", "+02014-02-11", "+002014-02-11", "-0001-01-01", "-00001-01-01", "-000001-01-01"]) add(text, "expanded-year", digits);
  let state = seed >>> 0;
  const random = (max: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return Math.floor(state / 4294967296 * max); };
  const pad = (value: number, digits = 2) => String(value).padStart(digits, "0");
  for (let i = 0; i < 600; i++) {
    const year = 1600 + random(801), month = 1 + random(14), day = 1 + random(34);
    let date = `${year}-${pad(month)}-${pad(day)}`;
    const kind = random(4);
    if (kind === 1) date = `${year}-${pad(1 + random(370), 3)}`;
    if (kind === 2) date = `${year}-W${pad(random(55))}-${random(9)}`;
    if (kind === 3) date = date.replaceAll("-", "");
    const separator = random(2) ? "T" : " ";
    const time = `${pad(random(27))}:${pad(random(65))}:${pad(random(65))}${random(3) === 0 ? (random(2) ? "." : ",") + pad(random(1000), 3) : ""}`;
    const offsets = ["", "Z", "+01:00", "-05:00", "+05:45", "-0330", "+13", "+02:60"];
    add(date + (random(5) === 0 ? "" : separator + time + offsets[random(offsets.length)]), "seeded-grammar");
  }
  return cases;
}
