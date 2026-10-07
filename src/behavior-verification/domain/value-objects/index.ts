import { createHash } from "node:crypto";
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const render = (item: unknown): string => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (!item || typeof item !== "object") throw new Error("Evidence must contain plain finite JSON values only");
    if (ancestors.has(item)) throw new Error("Evidence must not contain cycles");
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error("Evidence must contain plain finite JSON values only");
    if (Object.getOwnPropertySymbols(item).length) throw new Error("Evidence must not contain symbol properties");
    const keys = Object.keys(item);
    const ownNames = Object.getOwnPropertyNames(item).filter(name => !(array && name === "length"));
    if (ownNames.length !== keys.length) throw new Error("Evidence must not contain hidden properties");
    if (keys.some(key => { const descriptor = Object.getOwnPropertyDescriptor(item, key)!; return descriptor.get || descriptor.set; })) throw new Error("Evidence must not contain accessor properties");
    if (array && (keys.length !== item.length || keys.some((key, index) => key !== String(index)))) throw new Error("Evidence must not contain sparse or custom arrays");
    ancestors.add(item);
    const result = array ? "[" + item.map(render).join(",") + "]" : "{" + keys.sort().map(key => JSON.stringify(key) + ":" + render((item as Record<string, unknown>)[key])).join(",") + "}";
    ancestors.delete(item);
    return result;
  };
  return render(value);
}
export function hashJson(value: unknown): string { return sha256(canonicalJson(value)); }
export function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
