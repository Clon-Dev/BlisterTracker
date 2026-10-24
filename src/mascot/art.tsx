// The kitten's drawing, split into parts that share one 200×236 box so each can be animated on its own.
import { StyleSheet } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";
import type { SpecialId } from "./calendar";

export const ART_W = 200;
export const ART_H = 236;

const LINE = "#4A4A50";
const RED = "#DE4B3E";
const RED_DARK = "#B5342A";
const PINK = "#F5B5C3";
const NOSE = "#F2A1B1";
const RING = "#D9E4EE";
const SHADE = "#E7EDF4";
const PUPIL = "#36363C";
const WHITE = "#FFFFFF";

const line = { stroke: LINE, strokeWidth: 2.6, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
const round = { strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

// ---------- Outfits (the everyday one is the red sweater with the white heart) ----------

export type Motif = "heart" | "hearts" | "fist" | "atom" | "drop" | "pill" | "ribbon";
export type Outfit = {
  sweater: string; seam: string; motif: Motif; motifColor: string;
  hat?: "party" | "santa" | "witch"; bow?: string; scarf?: string; glasses?: boolean; confetti?: boolean;
};
const GOLD = "#F5C542";
const PINK_RIBBON = "#F7A8C0";
const ORANGE = "#F08A24";
const EVERYDAY: Outfit = { sweater: RED, seam: RED_DARK, motif: "heart", motifColor: WHITE };
export const OUTFITS: Record<SpecialId | "everyday", Outfit> = {
  everyday: EVERYDAY,
  newYear: { ...EVERYDAY, hat: "party", confetti: true },
  science: { sweater: "#2F8F8B", seam: "#1F6663", motif: "atom", motifColor: WHITE, glasses: true },
  valentine: { sweater: "#E86A92", seam: "#B9466C", motif: "hearts", motifColor: WHITE },
  womensDay: { sweater: "#7B3FA0", seam: "#55296F", motif: "fist", motifColor: WHITE },
  endometriosis: { ...EVERYDAY, motif: "ribbon", motifColor: GOLD },
  menstruation: { sweater: "#F7D3DC", seam: "#D79AAA", motif: "drop", motifColor: RED },
  contraception: { ...EVERYDAY, motif: "pill", hat: "party" },
  breastCancer: { ...EVERYDAY, motif: "ribbon", motifColor: PINK_RIBBON, bow: PINK_RIBBON },
  menopause: { ...EVERYDAY, scarf: ORANGE, bow: PINK_RIBBON },
  birthday: { ...EVERYDAY, hat: "party", confetti: true },
  halloween: { sweater: ORANGE, seam: "#C46612", motif: "heart", motifColor: WHITE, hat: "witch" },
  christmas: { ...EVERYDAY, hat: "santa" },
};

/** One part: an SVG filling the whole kitten box. */
const Part = ({ size, children }: { size: number; children: React.ReactNode }) => (
  <Svg width={size} height={(size * ART_H) / ART_W} viewBox={`0 0 ${ART_W} ${ART_H}`} style={StyleSheet.absoluteFill}>{children}</Svg>
);

type P = { size: number };

export const Shadow = ({ size }: P) => <Part size={size}><Ellipse cx={100} cy={226} rx={64} ry={7} fill="rgba(60,30,45,0.12)" /></Part>;

const TAIL = "M146 204 C172 206 186 188 183 160 C182 150 178 144 173 142";
export const Tail = ({ size }: P) => (
  <Part size={size}>
    <Path d={TAIL} fill="none" stroke={LINE} strokeWidth={15} strokeLinecap="round" />
    <Path d={TAIL} fill="none" stroke={WHITE} strokeWidth={9.5} strokeLinecap="round" />
  </Part>
);

export const Haunch = ({ size, side }: P & { side: "l" | "r" }) => (
  <Part size={size}><Ellipse cx={side === "l" ? 54 : 146} cy={206} rx={15} ry={15} fill={WHITE} {...line} /></Part>
);

type O = P & { outfit: Outfit };
const HEART = "M100 176 C91 170 86 165 86 160 C86 155.5 89.5 153 93.5 153 C96.5 153 98.8 155 100 157.5 C101.2 155 103.5 153 106.5 153 C110.5 153 114 155.5 114 160 C114 165 109 170 100 176 Z";

export const Body = ({ size, outfit: o }: O) => (
  <Part size={size}>
    <Path d="M60 142 C50 158 44 180 46 198 Q47 207 57 207 L143 207 Q153 207 154 198 C156 180 150 158 140 142 Z" fill={o.sweater} stroke={o.seam} {...round} strokeWidth={2.4} />
    <Path d="M68 150 C63 166 62 182 63 196" fill="none" stroke={o.seam} {...round} strokeWidth={2} opacity={0.8} />
    <Path d="M132 150 C137 166 138 182 137 196" fill="none" stroke={o.seam} {...round} strokeWidth={2} opacity={0.8} />
    <MotifArt outfit={o} />
  </Part>
);

/** The picture on the chest, centred around (100, 164). */
function MotifArt({ outfit: o }: { outfit: Outfit }) {
  const c = o.motifColor;
  switch (o.motif) {
    case "heart": return <Path d={HEART} fill={c} />;
    case "hearts": return <G>
      <Path d={HEART} fill={c} />
      {[[76, 186], [124, 186], [80, 152], [120, 152]].map(([x, y]) => (
        <Path key={`${x}${y}`} d={HEART} fill={c} opacity={0.85} transform={`translate(${x} ${y}) scale(0.42) translate(-100 -164)`} />
      ))}
    </G>;
    case "fist": return <G>
      <Rect x={95} y={166} width={10} height={14} rx={2} fill={c} />
      <Rect x={88.5} y={148} width={23} height={20} rx={5.5} fill={c} />
      <Path d="M94.5 148.8 V155 M100 148.8 V155 M105.5 148.8 V155 M89 159 Q96 156.5 101.5 160.5" fill="none" stroke={o.seam} {...round} strokeWidth={1.7} />
    </G>;
    case "atom": return <G>
      {[0, 60, 120].map((r) => <Ellipse key={r} cx={100} cy={164} rx={16} ry={6} fill="none" stroke={c} strokeWidth={2.2} transform={`rotate(${r} 100 164)`} />)}
      <Circle cx={100} cy={164} r={3.2} fill={c} />
    </G>;
    case "drop": return <G>
      <Path d="M100 149 C100 149 88 163 88 170 C88 177 93.5 181 100 181 C106.5 181 112 177 112 170 C112 163 100 149 100 149 Z" fill={c} />
      <Ellipse cx={95} cy={170} rx={2.4} ry={4} fill={WHITE} opacity={0.7} />
    </G>;
    case "pill": return <G transform="rotate(-35 100 165)">
      <Path d="M88 159 H100 V171 H88 A6 6 0 0 1 88 159 Z" fill={WHITE} />
      <Path d="M100 159 H112 A6 6 0 0 1 112 171 H100 Z" fill={PINK} />
      <Rect x={82} y={159} width={36} height={12} rx={6} fill="none" stroke={o.seam} strokeWidth={1.6} />
    </G>;
    case "ribbon": return (
      <Path fillRule="evenodd" fill={c} stroke={o.seam} strokeWidth={1.3} {...round}
        d="M100 149 C92 149 90 157 95 164 L86 181 L92 183 L100 170 L108 183 L114 181 L105 164 C110 157 108 149 100 149 Z M100 154 C103.5 154 104.5 158 100 162 C95.5 158 96.5 154 100 154 Z" />
    );
  }
}

export const Paw = ({ size, side, outfit: o }: O & { side: "l" | "r" }) => {
  const x = side === "l" ? 0 : 46;
  return (
    <Part size={size}>
      <G transform={`translate(${x} 0)`}>
        <Rect x={61} y={190} width={32} height={11} rx={4.5} fill={o.sweater} stroke={o.seam} {...round} strokeWidth={2.2} />
        <Path d="M63 199 Q63 219 77 219 Q91 219 91 199 Z" fill={WHITE} {...line} />
        <Path d="M73 212 L73 218 M81 212 L81 218" {...line} strokeWidth={2} />
      </G>
    </Part>
  );
};

export const Collar = ({ size, outfit: o }: O) => (
  <Part size={size}>
    <Rect x={55} y={126} width={90} height={24} rx={11} fill={o.sweater} stroke={o.seam} {...round} strokeWidth={2.4} />
    <Path d="M67 131 V145 M78 130 V146 M89 130 V146 M100 130 V146 M111 130 V146 M122 130 V146 M133 131 V145" stroke={o.seam} {...round} strokeWidth={1.6} opacity={0.65} />
    {o.scarf && <G>
      <Path d="M116 140 L131 141 L135 178 L119 180 Z" fill={o.scarf} {...line} strokeWidth={2.2} />
      <Rect x={51} y={123} width={98} height={27} rx={13} fill={o.scarf} {...line} strokeWidth={2.2} />
      <Path d="M70 126 V147 M84 125 V148 M98 125 V148 M112 125 V148 M126 125 V148 M120 160 L134 159" stroke={WHITE} strokeWidth={2} opacity={0.45} />
    </G>}
  </Part>
);

// ---------- Accessories ----------

/** On top of the head (moves with it). */
export const Hat = ({ size, kind }: P & { kind: NonNullable<Outfit["hat"]> }) => (
  <Part size={size}>
    {kind === "party" && <G>
      <Path d="M76 37 L106 4 L125 34 Q101 43 76 37 Z" fill={GOLD} {...line} strokeWidth={2.4} />
      <Path d="M90 22 L98 31 M99 12 L109 21 M104 35 L114 27" stroke="#E8577A" strokeWidth={2.8} {...round} />
      <Circle cx={106} cy={6} r={6} fill="#E8577A" {...line} strokeWidth={2} />
    </G>}
    {kind === "santa" && <G>
      <Path d="M76 34 C80 12 104 2 129 14 L122 33 Z" fill={RED} {...line} strokeWidth={2.2} />
      <Rect x={70} y={27} width={62} height={12} rx={6} fill={WHITE} {...line} strokeWidth={2.2} />
      <Circle cx={131} cy={15} r={7} fill={WHITE} {...line} strokeWidth={2} />
    </G>}
    {kind === "witch" && <G>
      <Ellipse cx={100} cy={33} rx={44} ry={7} fill="#3A2A4A" {...line} strokeWidth={2.2} />
      <Path d="M80 32 C88 22 94 8 114 1 C108 11 112 22 120 32 Z" fill="#3A2A4A" {...line} strokeWidth={2.2} />
      <Path d="M83 25 Q100 29 117 25 L118 30 Q100 34 82 30 Z" fill={ORANGE} />
    </G>}
  </Part>
);

/** A bow on the left ear (moves with the ear). */
export const Bow = ({ size, color }: P & { color: string }) => (
  <Part size={size}>
    <Path d="M52 31 L37 21 Q32 31 37 41 Z" fill={color} {...line} strokeWidth={2} />
    <Path d="M52 31 L67 21 Q72 31 67 41 Z" fill={color} {...line} strokeWidth={2} />
    <Circle cx={52} cy={31} r={4.6} fill={color} {...line} strokeWidth={2} />
  </Part>
);

/** Round glasses in front of the eyes (move with the face). */
export const Glasses = ({ size }: P) => (
  <Part size={size}>
    <Circle cx={68} cy={80} r={22} fill="rgba(190,225,255,0.22)" stroke={PUPIL} strokeWidth={3} />
    <Circle cx={132} cy={80} r={22} fill="rgba(190,225,255,0.22)" stroke={PUPIL} strokeWidth={3} />
    <Path d="M90 78 Q100 71 110 78" fill="none" stroke={PUPIL} strokeWidth={3} {...round} />
  </Part>
);

/** For a streak milestone: a little golden crown for the day. */
export const Crown = ({ size }: P) => (
  <Part size={size}>
    <Path d="M80 33 L82 13 L92 25 L100 8 L108 25 L118 13 L120 33 Z" fill={GOLD} {...line} strokeWidth={2.2} />
    <Circle cx={100} cy={27} r={3} fill="#E8577A" />
  </Part>
);

/** Confetti around the kitten (birthday, New Year). */
export const Confetti = ({ size }: P) => (
  <Part size={size}>
    {[[18, 40, "#E8577A"], [182, 54, GOLD], [12, 118, "#4FB3A9"], [188, 112, "#E8577A"], [26, 170, GOLD], [176, 168, "#7B3FA0"], [40, 14, "#4FB3A9"], [160, 18, "#7B3FA0"]]
      .map(([x, y, color], i) => <Rect key={i} x={x as number} y={y as number} width={7} height={4} rx={1.5} fill={color as string} transform={`rotate(${i * 37} ${x} ${y})`} />)}
  </Part>
);

const EAR_OUT = "M33 64 C28 42 32 20 41 8 C54 13 69 24 80 35 Z";
const EAR_IN = "M42 48 C40 35 42 25 46 18 C55 22 63 28 69 35 Z";
export const Ear = ({ size, side }: P & { side: "l" | "r" }) => (
  <Part size={size}>
    <G transform={side === "r" ? "translate(200 0) scale(-1 1)" : undefined}>
      <Path d={EAR_OUT} fill={WHITE} {...line} />
      <Path d={EAR_IN} fill={PINK} />
    </G>
  </Part>
);

export const Head = ({ size }: P) => (
  <Part size={size}>
    <Path d="M100 26 C141 26 170 45 174 80 C178 113 150 135 100 135 C50 135 22 113 26 80 C30 45 59 26 100 26 Z" fill={WHITE} {...line} />
    <Path d="M38 110 C55 127 145 127 162 110 C152 126 128 133.5 100 133.5 C72 133.5 48 126 38 110 Z" fill={SHADE} />
  </Part>
);

const Eye = ({ cx }: { cx: number }) => (
  <G>
    <Circle cx={cx} cy={80} r={19} fill={RING} />
    <Circle cx={cx} cy={80} r={15} fill={PUPIL} />
    <Circle cx={cx - 6} cy={74} r={5} fill={WHITE} />
    <Circle cx={cx + 5.5} cy={86} r={2} fill={WHITE} />
  </G>
);
export const Eyes = ({ size }: P) => <Part size={size}><Eye cx={68} /><Eye cx={132} /></Part>;

export type Expression = "normal" | "happy" | "sleepy" | "surprised";

/** Eyes that replace the open ones for an expression. */
export const ClosedEyes = ({ size, kind }: P & { kind: "happy" | "sleepy" }) => (
  <Part size={size}>
    {kind === "happy" ? <>
      <Path d="M55 84 Q68 68 81 84" fill="none" {...line} strokeWidth={3.6} />
      <Path d="M119 84 Q132 68 145 84" fill="none" {...line} strokeWidth={3.6} />
    </> : <>
      <Path d="M55 80 Q68 90 81 80" fill="none" {...line} strokeWidth={3.4} />
      <Path d="M119 80 Q132 90 145 80" fill="none" {...line} strokeWidth={3.4} />
    </>}
  </Part>
);

export const Blush = ({ size }: P) => (
  <Part size={size}>
    <Ellipse cx={50} cy={100} rx={9} ry={5} fill={PINK} opacity={0.75} />
    <Ellipse cx={150} cy={100} rx={9} ry={5} fill={PINK} opacity={0.75} />
  </Part>
);

export type Mouth = "smile" | "open" | "o";
export const Muzzle = ({ size, mouth }: P & { mouth: Mouth }) => (
  <Part size={size}>
    <Path d="M93 91 Q100 87 107 91 Q104.5 97 100 98 Q95.5 97 93 91 Z" fill={NOSE} />
    {mouth === "smile" && <Path d="M100 98 V100.5 M86 99 Q92.5 107 100 100.5 Q107.5 107 114 99" fill="none" {...line} strokeWidth={2.4} />}
    {mouth === "open" && <>
      <Path d="M91 101 Q100 98.5 109 101 Q107 113 100 113 Q93 113 91 101 Z" fill="#8A3B4A" {...line} strokeWidth={2.2} />
      <Path d="M94.5 108.5 Q100 104.5 105.5 108.5 Q103.5 112 100 112 Q96.5 112 94.5 108.5 Z" fill="#F08DA2" />
    </>}
    {mouth === "o" && <Ellipse cx={100} cy={106} rx={5} ry={6} fill="#8A3B4A" {...line} strokeWidth={2.2} />}
  </Part>
);
