// Special days: which outfit layers they set (looks.ts) and a once-a-year message with a matching fact or milestone.
// Pure, unit-tested. Each awareness day links the page that defines it; the texts are `mascotSpecial` in i18n.ts.
//
// Collisions (approved): an awareness print beats a fun print (Halloween keeps its orange sweater under it); a single
// day's print beats a month's (the day's ribbon replaces Pink October's); one accessory set wins by rank: carnival >
// single days > Women-in-Science glasses > seasons (summer, Advent) > Pink October's bow; the sleeping cap only when
// nothing but a print (or the bow) is on.
import { composeLook, EVERYDAY, PRINTS, ACCESSORIES, type AccessoryId, type Layers, type Outfit, type PrintId } from "./looks";

export type SpecialId =
  | "newYear" | "carnival" | "worldCancer" | "science" | "valentine" | "hpvDay" | "womensDay" | "endometriosis" | "spring"
  | "easter" | "worldHealth" | "menstruation" | "summer" | "catDay" | "sexualHealth" | "autumn" | "contraception"
  | "breastCancer" | "mentalHealth" | "menopause" | "birthday" | "halloween" | "worldAids" | "advent" | "nikolaus" | "christmas";

export type Special = {
  id: SpecialId;
  /** What Nyxi adds to the message: a fact (facts.ts tag) or a milestone (herstory.ts tag). */
  item?: { kind: "fact" | "herstory"; tag: string };
  /** The page that defines the day (awareness days only). */
  source?: { source: string; url: string };
};

type Event = Special & {
  on: (day: string, md: string) => boolean;
  /** Sweater print: awareness (health days) or fun; a higher rank wins within its kind. */
  print?: { id: PrintId; kind: "awareness" | "fun"; rank: number };
  accessories?: { id: AccessoryId; rank: number };
};

/** The day Nyxi joined the app. */
export const NYXI_BIRTHDAY = "2026-10-23";

const DAY = 20; // a single day beats …
const MONTH = 10; // … a month or season

const is = (...mds: string[]) => (_: string, md: string) => mds.includes(md);
const between = (from: string, to: string) => (_: string, md: string) => md >= from && md <= to;

const EVENTS: Event[] = [
  { id: "newYear", on: is("01-01", "12-31"), accessories: { id: "newYear", rank: 30 } },
  // Weiberfastnacht to Rosenmontag; the mask beats the Women-in-Science glasses.
  { id: "carnival", on: (day) => nearEaster(day, -52, -48), accessories: { id: "carnival", rank: 35 } },
  { id: "worldCancer", on: is("02-04"), print: { id: "worldCancer", kind: "awareness", rank: DAY },
    source: { source: "UICC", url: "https://www.worldcancerday.org/what-world-cancer-day" }, item: { kind: "fact", tag: "breast-early-detection" } },
  { id: "science", on: is("02-11"), print: { id: "science", kind: "awareness", rank: DAY }, accessories: { id: "science", rank: 25 },
    source: { source: "UN", url: "https://www.un.org/en/observances/women-and-girls-in-science-day" }, item: { kind: "herstory", tag: "curie-nobel" } },
  { id: "valentine", on: is("02-14"), print: { id: "valentine", kind: "fun", rank: DAY } },
  { id: "hpvDay", on: is("03-04"), print: { id: "hpvDay", kind: "awareness", rank: DAY },
    source: { source: "International Papillomavirus Society", url: "https://ipvsoc.org/news/4th-march-international-hpv-awareness-day/" }, item: { kind: "fact", tag: "hpv-common" } },
  { id: "womensDay", on: is("03-08"), print: { id: "womensDay", kind: "awareness", rank: DAY },
    source: { source: "UN WomenWatch", url: "https://www.un.org/womenwatch/feature/iwd/history.html" }, item: { kind: "herstory", tag: "iwd-first" } },
  { id: "endometriosis", on: between("03-09", "03-31"), print: { id: "endometriosis", kind: "awareness", rank: MONTH },
    source: { source: "endometriosis.org", url: "https://endometriosis.org/news/support-awareness/endometriosis-awareness-2020/" }, item: { kind: "fact", tag: "endo-prevalence" } },
  { id: "spring", on: is("03-20"), accessories: { id: "spring", rank: 30 } },
  { id: "easter", on: (day) => nearEaster(day, 0, 1), print: { id: "easter", kind: "fun", rank: DAY }, accessories: { id: "easter", rank: 30 } },
  { id: "worldHealth", on: is("04-07"), print: { id: "worldHealth", kind: "awareness", rank: DAY },
    source: { source: "WHO", url: "https://www.who.int/about/history" }, item: { kind: "fact", tag: "cervical-preventable" } },
  { id: "menstruation", on: is("05-28"), print: { id: "menstruation", kind: "awareness", rank: DAY },
    source: { source: "Menstrual Hygiene Day", url: "https://www.menstrualhygieneday.org/about" }, item: { kind: "fact", tag: "period-blood-amount" } },
  { id: "summer", on: between("07-01", "08-31"), accessories: { id: "summer", rank: MONTH } },
  { id: "catDay", on: is("08-08"), accessories: { id: "catDay", rank: 30 } },
  { id: "sexualHealth", on: is("09-04"), print: { id: "sexualHealth", kind: "awareness", rank: DAY },
    source: { source: "World Association for Sexual Health", url: "https://www.worldsexualhealth.net/about-world-sexual-health-day" }, item: { kind: "fact", tag: "consent-withdraw" } },
  { id: "autumn", on: is("09-22"), accessories: { id: "autumn", rank: 30 } },
  { id: "contraception", on: is("09-26"), print: { id: "contraception", kind: "awareness", rank: DAY },
    source: { source: "WHO", url: "https://www.who.int/srilanka/news/detail/26-09-2021-world-contraception-day-2021" }, item: { kind: "herstory", tag: "anovlar-de" } },
  { id: "breastCancer", on: between("10-01", "10-31"), print: { id: "breastCancer", kind: "awareness", rank: MONTH }, accessories: { id: "breastCancer", rank: 5 },
    source: { source: "WHO", url: "https://www.emro.who.int/media/news/pink-october-breast-cancer-awareness-month.html" }, item: { kind: "fact", tag: "breast-know-normal" } },
  { id: "mentalHealth", on: is("10-10"), print: { id: "mentalHealth", kind: "awareness", rank: DAY },
    source: { source: "WHO", url: "https://www.who.int/campaigns/world-mental-health-day" }, item: { kind: "fact", tag: "pmdd" } },
  { id: "menopause", on: is("10-18"), print: { id: "menopause", kind: "awareness", rank: DAY },
    source: { source: "International Menopause Society", url: "https://www.imsociety.org/education/world-menopause-day/" }, item: { kind: "fact", tag: "menopause-age" } },
  { id: "birthday", on: is("10-23"), accessories: { id: "birthday", rank: 30 } },
  { id: "halloween", on: is("10-31"), print: { id: "halloween", kind: "fun", rank: DAY }, accessories: { id: "halloween", rank: 30 } },
  { id: "worldAids", on: is("12-01"), print: { id: "worldAids", kind: "awareness", rank: DAY },
    source: { source: "WHO", url: "https://www.who.int/southeastasia/news/events/world-aids-day" }, item: { kind: "herstory", tag: "hiv-discovery" } },
  { id: "advent", on: between("12-01", "12-23"), accessories: { id: "advent", rank: MONTH } },
  { id: "nikolaus", on: is("12-06"), accessories: { id: "nikolaus", rank: 30 } },
  { id: "christmas", on: between("12-24", "12-26"), print: { id: "christmas", kind: "fun", rank: DAY }, accessories: { id: "christmas", rank: 30 } },
];

/** Easter Sunday of a year ("YYYY-MM-DD"), Gregorian calendar (the anonymous Gregorian algorithm, "Meeus/Jones/Butcher"). */
export function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Whether `day` is between `from` and `to` days after Easter Sunday of its year (negative: before). */
function nearEaster(day: string, from: number, to: number) {
  const offset = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${easterSunday(Number(day.slice(0, 4)))}T00:00:00Z`)) / 864e5);
  return offset >= from && offset <= to;
}

const eventsOn = (day: string) => EVENTS.filter((e) => e.on(day, day.slice(5)));
const top = <T,>(items: T[], rank: (x: T) => number) => items.reduce<T | null>((best, x) => (best === null || rank(x) > rank(best) ? x : best), null);

/** The special days on `day`, in the order Nyxi mentions them: health days first (a single day before a month). */
export function specialsOn(day: string): Special[] {
  const score = (e: Event) => (e.print?.kind === "awareness" ? 100 + e.print.rank : e.accessories?.rank ?? e.print?.rank ?? 0);
  return eventsOn(day).sort((a, b) => score(b) - score(a)).map(({ id, item, source }) => ({ id, ...(item ? { item } : {}), ...(source ? { source } : {}) }));
}

/** Which print and accessory set `day` brings. */
export function layersOn(day: string): Layers {
  const events = eventsOn(day);
  const print = (kind: "awareness" | "fun") => top(events.filter((e) => e.print?.kind === kind), (e) => e.print!.rank)?.print!.id ?? null;
  return { awareness: print("awareness"), fun: print("fun"), accessories: top(events.filter((e) => e.accessories), (e) => e.accessories!.rank)?.accessories!.id ?? null };
}

/** Today's outfit: the day's layers combined (see looks.ts), at `hour`, with the streak crown if earned today. */
export const lookOn = (day: string, hour: number, streakCrown = false) => composeLook(layersOn(day), hour, streakCrown);

/** Outfits for the wardrobe: each special day's look on its own, and the pyjamas. */
export const WARDROBE: (SpecialId | "pyjamas")[] = [...EVENTS.map((e) => e.id), "pyjamas"];
export function wardrobeLook(id: SpecialId | "pyjamas"): Outfit {
  if (id === "pyjamas") return composeLook({ awareness: null, fun: null, accessories: null }, 23, false).outfit;
  const e = EVENTS.find((x) => x.id === id)!;
  return { ...(e.print ? PRINTS[e.print.id] : EVERYDAY), ...(e.accessories ? ACCESSORIES[e.accessories.id] : {}) };
}

/** How old Nyxi turns on `day` (0 in the year it joined). */
export const nyxiAge = (day: string) => Number(day.slice(0, 4)) - Number(NYXI_BIRTHDAY.slice(0, 4));
