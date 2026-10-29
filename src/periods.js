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

/**
 * Quarter pot buttons: the three visible quarters plus the next `extra` (Tom, 2026-10-27: Q3 and Q4
 * 2027 too). The extra ones carry the year in their label ("Q3 '27"), since Q4 repeats otherwise.
 * Capacity cards stay on the three visible quarters.
 */
export function potQuarters(h, extra = 2) {
  const out = h.map((q) => ({ lastFriday: q.lastFriday, shortLabel: q.shortLabel }));
  let cur = { year: h[h.length - 1].year, q: h[h.length - 1].q };
  for (let i = 0; i < extra; i++) {
    cur = nextQuarter(cur);
    out.push({ lastFriday: lastFridayOfQuarter(cur.year, cur.q), shortLabel: `Q${cur.q} '${String(cur.year).slice(2)}` });
  }
  return out;
}

/**
 * Month buttons up to the last pot quarter (Tom, 2026-10-29: "month options for the entire year"):
 * the horizon's months, then each month of the `extra` quarters after it, labelled with the year
 * ("Jul '27") so they cannot be mixed up with this year's.
 */
export function potMonths(h, extra = 2) {
  const out = h.flatMap((q) => q.months.map((m) => ({ lastFriday: m.lastFriday, label: m.label, quarterEnd: q.lastFriday })));
  let cur = { year: h[h.length - 1].year, q: h[h.length - 1].q };
  for (let i = 0; i < extra; i++) {
    cur = nextQuarter(cur);
    const qEnd = lastFridayOfQuarter(cur.year, cur.q);
    for (let k = 0; k < 3; k++) {
      const m0 = (cur.q - 1) * 3 + k;
      out.push({ lastFriday: lastFridayOfMonth(cur.year, m0), label: `${MONTHS[m0]} '${String(cur.year).slice(2)}`, quarterEnd: qEnd });
    }
  }
  return out;
}

// One date format everywhere in the planner: DD/MM/YYYY (Tom, 2026-10-27).
const pad = (n) => String(n).padStart(2, '0');
export function formatDate(iso) {
  if (!iso) return '';
  const d = parseISO(String(iso).slice(0, 10));
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Timestamps (sync times, audit rows): DD/MM/YYYY HH:MM in the viewer's time zone. */
export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Every ISO date (YYYY-MM-DD) inside a text, shown as DD/MM/YYYY. */
export const formatDatesIn = (s) => String(s ?? '').replace(/\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\b/g, (_, y, m, d) => `${d}/${m}/${y}`);

/**
 * Planned after the committed date, in a way that needs action (Tom, 2026-10-27). Work is planned on
 * a month pot (last Friday of a month) or a quarter pot (last Friday of a quarter, Start = End).
 * - Month pot in the same month as the committed date: covered (engineers plan it before the date).
 * - Pot in a later month (e.g. a quarter pot in March for a 15/01 commit): late, move it to a month pot.
 * - Dated work (Start ≠ End): late when it ends after the committed date.
 * - Never late when it ends in the same week (Monday to Sunday) as the committed date (Tom, 2026-10-27).
 * The quarter pot date equals the last month's pot date, so a commit in that same month counts as covered.
 */
function weekMonday(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function lateVsCommit({ start, end, committed } = {}) {
  if (!committed || !end) return false;
  const e = String(end).slice(0, 10); const c = String(committed).slice(0, 10);
  if (e <= c) return false;
  if (weekMonday(e) === weekMonday(c)) return false;
  const pot = !start || String(start).slice(0, 10) === e;
  return !(pot && e.slice(0, 7) === c.slice(0, 7));
}
