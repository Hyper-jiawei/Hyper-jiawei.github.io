import { site } from "../site.config";
// Which festive mark (if any) replaces the apostrophe of the wordmark today.
// Dates are Beijing dates. Priority: birthday, then holidays, then solar terms.

const SOLAR = "Asia/Shanghai";

// Solar terms in order of the sun's apparent longitude, from 0° (春分) in 15° steps.
const TERMS = [
  "春分", "清明", "谷雨", "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑", "白露",
  "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至", "小寒", "大寒", "立春", "雨水", "惊蛰",
];

const FIXED: Record<string, string> = {
  "1-1": "元旦",
  "2-14": "情人节",
  "5-1": "劳动节",
  "6-1": "儿童节",
  "7-4": "美国独立日",
  "10-1": "国庆",
  "10-10": "双十节",
  "10-31": "万圣节",
  "12-25": "圣诞节",
};

const LUNAR: Record<string, string> = {
  "1-1": "春节",
  "1-15": "元宵",
  "5-5": "端午",
  "7-7": "七夕",
  "8-15": "中秋",
  "9-9": "重阳",
  "12-8": "腊八",
};

const DAY = 86400000;

function beijingDate(t: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: SOLAR, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(t);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** "month-day" in the Chinese calendar, or null in a leap month or without support. */
function lunarDate(t: number): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-u-ca-chinese", { timeZone: SOLAR, month: "numeric", day: "numeric" }).formatToParts(t);
    const month = parts.find((p) => p.type === "month")?.value ?? "";
    const day = parts.find((p) => p.type === "day")?.value ?? "";
    if (!/^\d+$/.test(month) || !/^\d+$/.test(day)) return null;
    return `${Number(month)}-${Number(day)}`;
  } catch {
    return null;
  }
}

/** The sun's apparent ecliptic longitude in degrees (Meeus, low precision: about 0.01°). */
export function sunLongitude(t: number) {
  const rad = Math.PI / 180;
  // Universal time to terrestrial time: about 69 s in these years.
  const T = ((t + 69000) / DAY + 2440587.5 - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * rad;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * rad;
  const lon = L0 + C - 0.00569 - 0.00478 * Math.sin(omega);
  return ((lon % 360) + 360) % 360;
}

/** The solar term that begins during the given Beijing day, if any. */
export function solarTerm(y: number, m: number, d: number): string | null {
  const start = Date.UTC(y, m - 1, d) - 8 * 3600000;
  const a = Math.floor(sunLongitude(start) / 15);
  const b = Math.floor(sunLongitude(start + DAY) / 15);
  return a === b ? null : TERMS[b % 24];
}

export function festiveKey(t = Date.now()): string | null {
  const { y, m, d } = beijingDate(t);
  if (site.birthday && m === site.birthday.month && d === site.birthday.day) return "生日";
  const fixed = FIXED[`${m}-${d}`];
  if (fixed) return fixed;
  const lunar = lunarDate(t);
  if (lunar && LUNAR[lunar]) return LUNAR[lunar];
  if (lunarDate(t + DAY) === "1-1") return "除夕";
  return solarTerm(y, m, d);
}

const HEADWEAR: Record<string, string> = { 圣诞节: "christmas", 万圣节: "halloween", 生日: "birthday", 清明: "qingming", 重阳: "chongyang" };

/** What the footer avatar wears today: a hat or hair ornament on days whose customs
 *  call for one, otherwise the season's piece. Seasons start at 立春, 立夏, 立秋, 立冬. */
export function headwearKey(t = Date.now()): string {
  const key = festiveKey(t);
  if (key && HEADWEAR[key]) return HEADWEAR[key];
  // The season turns on the day of its term, whatever the hour the term begins.
  const { y, m, d } = beijingDate(t);
  const lon = sunLongitude(Date.UTC(y, m - 1, d + 1) - 8 * 3600000);
  if (lon >= 315 || lon < 45) return "spring";
  if (lon < 135) return "summer";
  if (lon < 225) return "autumn";
  return "winter";
}

/** The markup for a mark in place of the apostrophe: hover lift / switch motion / click hop / placement. */
export function markMarkup(name: string, place: string, svg: string, extra = "") {
  return `<g class="wm-tick wm-mark" data-name="${name}"${extra}><g class="wm-mark-slot"><g class="wm-mark-pop"><g transform="${place}">${svg}</g></g></g></g>`;
}

/** A still, invisible target over the mark's resting and lifted positions. Hovering
 *  lifts the mark away from the pointer, so clicks land on this instead of the mark. */
export function markHit(place: string) {
  const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(place);
  if (!m) return "";
  const [x, y, s] = m.slice(1).map(Number);
  const pad = 40;
  // The mark's 100-unit box, plus the 200 units it floats up on hover.
  return `<rect class="wm-mark-hit" x="${x - pad}" y="${y - 200 - pad}" width="${100 * s + 2 * pad}" height="${100 * s + 200 + 2 * pad}" fill="none" pointer-events="all"/>`;
}

/** A click on a mark in a big wordmark plays that mark's own animation. */
export function popMark(mark: Element) {
  void import("./mark-motion").then(({ play }) => play(mark));
}
