// Special days: Nyxi's outfit and a one-time message (per year) with a matching fact or milestone. Pure, unit-tested.
// Each awareness day links the page that defines it; the texts are `mascotSpecial` in i18n.ts.

export type SpecialId =
  | "newYear" | "science" | "valentine" | "womensDay" | "endometriosis" | "menstruation" | "contraception"
  | "breastCancer" | "menopause" | "birthday" | "halloween" | "christmas";

export type Special = {
  id: SpecialId;
  /** What Nyxi adds to the greeting: a fact (facts.ts tag) or a milestone (herstory.ts tag). */
  item?: { kind: "fact" | "herstory"; tag: string };
  /** The page that defines the day (awareness days only). */
  source?: { source: string; url: string };
};

/** The day Nyxi joined the app. */
export const NYXI_BIRTHDAY = "2026-10-23";

const DAYS: Record<SpecialId, Omit<Special, "id">> = {
  newYear: {},
  science: { source: { source: "UN", url: "https://www.un.org/en/observances/women-and-girls-in-science-day" }, item: { kind: "herstory", tag: "curie-nobel" } },
  valentine: {},
  womensDay: { source: { source: "UN WomenWatch", url: "https://www.un.org/womenwatch/feature/iwd/history.html" }, item: { kind: "herstory", tag: "iwd-first" } },
  endometriosis: { source: { source: "endometriosis.org", url: "https://endometriosis.org/news/support-awareness/endometriosis-awareness-2020/" }, item: { kind: "fact", tag: "endo-prevalence" } },
  menstruation: { source: { source: "Menstrual Hygiene Day", url: "https://www.menstrualhygieneday.org/about" }, item: { kind: "fact", tag: "period-blood-amount" } },
  contraception: { source: { source: "WHO", url: "https://www.who.int/srilanka/news/detail/26-09-2021-world-contraception-day-2021" }, item: { kind: "herstory", tag: "anovlar-de" } },
  breastCancer: { source: { source: "WHO", url: "https://www.emro.who.int/media/news/pink-october-breast-cancer-awareness-month.html" }, item: { kind: "fact", tag: "breast-know-normal" } },
  menopause: { source: { source: "International Menopause Society", url: "https://www.imsociety.org/education/world-menopause-day/" }, item: { kind: "fact", tag: "menopause-age" } },
  birthday: {},
  halloween: {},
  christmas: {},
};

/** The special day for a "YYYY-MM-DD" day, or null. A single day beats a month (e.g. Halloween in October). */
export function specialDay(day: string): Special | null {
  const md = day.slice(5);
  const id: SpecialId | null =
    md === "01-01" || md === "12-31" ? "newYear"
      : md === "02-11" ? "science"
        : md === "02-14" ? "valentine"
          : md === "03-08" ? "womensDay"
            : md >= "03-09" && md <= "03-31" ? "endometriosis"
              : md === "05-28" ? "menstruation"
                : md === "09-26" ? "contraception"
                  : md === "10-18" ? "menopause"
                    : md === "10-23" ? "birthday"
                      : md === "10-31" ? "halloween"
                        : md >= "10-01" && md <= "10-31" ? "breastCancer"
                          : md >= "12-24" && md <= "12-26" ? "christmas"
                            : null;
  return id ? { id, ...DAYS[id] } : null;
}

/** How old Nyxi turns on `day` (0 in the year it joined). */
export const nyxiAge = (day: string) => Number(day.slice(0, 4)) - Number(NYXI_BIRTHDAY.slice(0, 4));

/** Outfit for the day: the special day's, or the everyday one. */
export const outfitId = (day: string) => specialDay(day)?.id ?? "everyday";
