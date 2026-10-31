// What Nyxi wears: two layers that combine.
//   - Print: the sweater's colour and the picture on the chest. Health-awareness days set it; otherwise a fun day
//     (Valentine's, Christmas, Easter, Halloween); otherwise the everyday red sweater with the heart.
//   - Accessories: exactly one set at a time (never mixed): hats, masks, wings, ears, glasses, crowns, the sleeping cap …
// After 22:00, on a day without special accessories, Nyxi wears pyjamas with the day's print on them.
// Pure (no React), unit-tested in scripts/test-mascot.ts; the drawing is in art.tsx.

export type Motif = "heart" | "hearts" | "fist" | "atom" | "drop" | "pill" | "ribbon" | "snowflake" | "egg" | "stethoscope" | "heartBadge";
export type Print = { sweater: string; seam: string; motif: Motif; motifColor: string; /** Pyjama stripes. */ stripes?: string };
export type Accessories = {
  hat?: "party" | "santa" | "witch" | "sun" | "sleep"; bow?: string; scarf?: string; scarfLeaves?: boolean;
  glasses?: "lab" | "sun"; mask?: boolean; confetti?: boolean; wings?: boolean; fangs?: boolean; bunnyEars?: boolean;
  flowerCrown?: boolean; earmuffs?: boolean; boot?: boolean; crown?: boolean;
};
export type Outfit = Print & Accessories;

const RED = "#DE4B3E";
const RED_DARK = "#B5342A";
const WHITE = "#FFFFFF";
const GOLD = "#F5C542";
const ORANGE = "#F08A24";
const PINK_RIBBON = "#F7A8C0";

export const EVERYDAY: Print = { sweater: RED, seam: RED_DARK, motif: "heart", motifColor: WHITE };
const ribbon = (color: string): Print => ({ ...EVERYDAY, motif: "ribbon", motifColor: color });

export type PrintId =
  | "worldCancer" | "science" | "hpvDay" | "womensDay" | "endometriosis" | "worldHealth" | "menstruation" | "sexualHealth"
  | "contraception" | "breastCancer" | "mentalHealth" | "menopause" | "worldAids"
  | "valentine" | "christmas" | "easter" | "halloween";
export const PRINTS: Record<PrintId, Print> = {
  worldCancer: ribbon("#B9A0DB"),
  science: { sweater: "#2F8F8B", seam: "#1F6663", motif: "atom", motifColor: WHITE },
  hpvDay: ribbon("#4FC7BF"),
  womensDay: { sweater: "#7B3FA0", seam: "#55296F", motif: "fist", motifColor: WHITE },
  endometriosis: ribbon(GOLD),
  worldHealth: { ...EVERYDAY, motif: "stethoscope" },
  menstruation: { sweater: "#F7D3DC", seam: "#D79AAA", motif: "drop", motifColor: RED },
  sexualHealth: { ...EVERYDAY, motif: "heartBadge" },
  contraception: { ...EVERYDAY, motif: "pill" },
  breastCancer: ribbon(PINK_RIBBON),
  mentalHealth: ribbon("#5DBB63"),
  menopause: ribbon(ORANGE),
  worldAids: { sweater: "#F4EFE6", seam: "#CFC4B2", motif: "ribbon", motifColor: "#D7262E" },
  valentine: { sweater: "#E86A92", seam: "#B9466C", motif: "hearts", motifColor: WHITE },
  christmas: { sweater: "#2E7D4F", seam: "#1E5A37", motif: "snowflake", motifColor: WHITE },
  easter: { sweater: "#F3E3A1", seam: "#CDB65E", motif: "egg", motifColor: "#B98AE0" },
  halloween: { sweater: ORANGE, seam: "#C46612", motif: "heart", motifColor: WHITE },
};

export type AccessoryId =
  | "newYear" | "carnival" | "science" | "spring" | "easter" | "summer" | "catDay" | "autumn" | "birthday" | "halloween"
  | "breastCancer" | "advent" | "nikolaus" | "christmas";
export const ACCESSORIES: Record<AccessoryId, Accessories> = {
  newYear: { hat: "party", confetti: true },
  carnival: { mask: true, confetti: true },
  science: { glasses: "lab" },
  spring: { flowerCrown: true },
  easter: { bunnyEars: true },
  summer: { hat: "sun", glasses: "sun" },
  catDay: { crown: true },
  autumn: { scarf: "#D9A23A", scarfLeaves: true },
  birthday: { hat: "party", confetti: true },
  halloween: { hat: "witch", wings: true, fangs: true },
  breastCancer: { bow: PINK_RIBBON },
  advent: { earmuffs: true, scarf: "#2E7D4F" },
  nikolaus: { hat: "santa", boot: true },
  christmas: { hat: "santa" },
};
/** Accessories that make way for the pyjamas' sleeping cap at night (Pink October's ear bow). */
const SOFT: AccessoryId[] = ["breastCancer"];

export const PYJAMAS: Print = { sweater: "#3D4F86", seam: "#2A3866", motif: "heart", motifColor: WHITE, stripes: "#8FA6D6" };
const SLEEP_CAP: Accessories = { hat: "sleep" };
const STREAK_CROWN: Accessories = { crown: true };
/** From this hour Nyxi wears pyjamas (on a day without special accessories). */
export const PYJAMA_HOUR = 22;

/** One day's layers, found by the calendar (highest priority first in each). */
export type Layers = { awareness: PrintId | null; fun: PrintId | null; accessories: AccessoryId | null };

/**
 * Today's outfit. The awareness print beats the fun print (Halloween keeps its orange sweater under it); one accessory
 * set; else the streak crown; else, from 22:00, pyjamas (with the day's print) and a sleeping cap.
 */
export function composeLook(layers: Layers, hour: number, streakCrown: boolean): { outfit: Outfit; pyjamas: boolean } {
  let print: Print = layers.awareness ? PRINTS[layers.awareness] : layers.fun ? PRINTS[layers.fun] : EVERYDAY;
  if (layers.awareness && layers.fun === "halloween") print = { ...print, sweater: PRINTS.halloween.sweater, seam: PRINTS.halloween.seam };
  const hard = layers.accessories && !SOFT.includes(layers.accessories) ? layers.accessories : null;
  if (hard) return { outfit: { ...print, ...ACCESSORIES[hard] }, pyjamas: false };
  if (streakCrown) return { outfit: { ...print, ...STREAK_CROWN }, pyjamas: false };
  if (hour >= PYJAMA_HOUR) {
    // The day's print (if any) goes on the pyjamas; the pyjamas keep their own colour.
    const special = layers.awareness || layers.fun;
    return { outfit: { ...PYJAMAS, ...(special ? { motif: print.motif, motifColor: print.motifColor } : {}), ...SLEEP_CAP }, pyjamas: true };
  }
  return { outfit: { ...print, ...(layers.accessories ? ACCESSORIES[layers.accessories] : {}) }, pyjamas: false };
}
