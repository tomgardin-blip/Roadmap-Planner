// Planning periods: quarters, months and the "last Friday" placeholder dates.
// SPEC.md > Planning rules > Where an issue lands / Horizon.
// All dates are plain ISO strings (YYYY-MM-DD) handled in UTC so no timezone
// can shift a Friday onto a Thursday.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseISO(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date) {
  return date.toISOString().slice(0, 10);
}

/** Last Friday of a month. month0 is 0-based (0 = January). */
export function lastFridayOfMonth(year, month0) {
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  const back = (last.getUTCDay() - 5 + 7) % 7;
  last.setUTCDate(last.getUTCDate() - back);
  return toISO(last);
}

/** Last Friday of a quarter (q = 1..4) = last Friday of its third month. */
export function lastFridayOfQuarter(year, q) {
  return lastFridayOfMonth(year, q * 3 - 1);
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}

export function quarterOf(iso) {
  const d = parseISO(iso);
  return { year: d.getUTCFullYear(), q: Math.floor(d.getUTCMonth() / 3) + 1 };
}

export function quarterKey(year, q) {
  return `${year}-Q${q}`;
}

function nextQuarter({ year, q }) {
  return q === 4 ? { year: year + 1, q: 1 } : { year, q: q + 1 };
}

/**
 * The three visible quarters: current (tight), next (near capacity), pot.
 * Each quarter carries its three months with their last-Friday dates.
 */
export function horizon(todayISO) {
  const roles = ['current', 'next', 'pot'];
  const out = [];
  let cur = quarterOf(todayISO);
  for (const role of roles) {
    const months = [0, 1, 2].map((i) => {
      const month0 = (cur.q - 1) * 3 + i;
      return {
        key: `${cur.year}-${String(month0 + 1).padStart(2, '0')}`,
        label: MONTHS[month0],
        year: cur.year,
        lastFriday: lastFridayOfMonth(cur.year, month0),
      };
    });
    out.push({
      key: quarterKey(cur.year, cur.q),
      label: `Q${cur.q} ${cur.year}`,
      shortLabel: `Q${cur.q}`,
      role,
      year: cur.year,
      q: cur.q,
      lastFriday: lastFridayOfQuarter(cur.year, cur.q),
      months,
    });
    cur = nextQuarter(cur);
  }
  return out;
}

/** True when an issue's End sits on its quarter's last Friday (quarter-level placement). */
export function isQuarterPlacement(endISO) {
  const { year, q } = quarterOf(endISO);
  return endISO === lastFridayOfQuarter(year, q);
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = parseISO(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
