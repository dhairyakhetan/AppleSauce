/* One way to say a monthly fee range, for the teachers table, the listed
   teachers tab and the applications views. A fee that is missing, zero or not a
   number counts as "not set", so a half-filled range never reads as
   "Rs 2000-undefined". */

const rupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

function clean(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const fmt = (n: number) => `₹${rupees.format(n)}`;

export function formatFeeRange(min: number | string | null | undefined, max: number | string | null | undefined): string {
  const lo = clean(min);
  const hi = clean(max);
  if (lo !== null && hi !== null) return lo === hi ? fmt(lo) : `${fmt(lo)} to ${fmt(hi)}`;
  if (lo !== null) return `${fmt(lo)} onwards`;
  if (hi !== null) return `Up to ${fmt(hi)}`;
  return 'Not set';
}
