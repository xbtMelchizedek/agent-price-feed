// Exact decimal arithmetic on strings via BigInt at 1e-12. Prices in a snapshot are strings; they stay exact here.
const SCALE = 12;
const ONE = 10n ** BigInt(SCALE);
const RE = /^\d{1,15}(\.\d{1,18})?$/;

/** Decimal string to BigInt pico-units; digits beyond 12 places are truncated. Null for anything that is not a price. */
export function toPico(s) {
  if (typeof s !== 'string' || !RE.test(s)) return null;
  const [i, f = ''] = s.split('.');
  return BigInt(i) * ONE + BigInt((f + '0'.repeat(SCALE)).slice(0, SCALE));
}

export function fromPico(n) {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const f = (a % ONE).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${a / ONE}${f ? `.${f}` : ''}`;
}

/** Cost of one IU (750k input + 250k output tokens) from per-1M prices. Null if either price is missing. */
export function iuOf(inPer1M, outPer1M) {
  const i = toPico(inPer1M);
  const o = toPico(outPer1M);
  if (i === null || o === null) return null;
  return (i * 3n + o) / 4n;
}

/** Signed change in basis points from a to b (a > 0). */
export function bps(a, b) {
  return Number(((b - a) * 10000n) / a);
}
