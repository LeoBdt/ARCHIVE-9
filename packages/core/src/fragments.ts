/** Crockford's alphabet: no I, L, O or U, so a reference reads and types without doubt. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const FRAGMENT_REF_LENGTH = 6;

/** A random fragment reference such as `K7QX3M`. */
export function newFragmentRef(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(random(FRAGMENT_REF_LENGTH), (b) => ALPHABET[b % 32] ?? "0").join("");
}

/** `#k7qx3m`, `K7QX3M` or `k7-qx3m` → `K7QX3M`; null when it isn't a reference. */
export function parseFragmentRef(value: string): string | null {
  const clean = value.trim().replace(/^#/, "").replace(/[\s-]/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  return clean.length === FRAGMENT_REF_LENGTH && /^[0-9A-HJKMNP-TV-Z]+$/.test(clean) ? clean : null;
}

/** `F012` from 12. */
export function fragmentCode(n: number): string {
  return `F${String(n).padStart(3, "0")}`;
}

/** `F12`, `f012` → 12; null otherwise. */
export function parseFragmentNumber(value: string): number | null {
  const match = /^F0*(\d{1,5})$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}
