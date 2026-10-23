// The kitten's drawing, split into parts that share one 200×236 box so each can be animated on its own.
import { StyleSheet } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";

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
const seam = { stroke: RED_DARK, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

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

export const Body = ({ size }: P) => (
  <Part size={size}>
    <Path d="M60 142 C50 158 44 180 46 198 Q47 207 57 207 L143 207 Q153 207 154 198 C156 180 150 158 140 142 Z" fill={RED} {...seam} strokeWidth={2.4} />
    <Path d="M68 150 C63 166 62 182 63 196" fill="none" {...seam} strokeWidth={2} opacity={0.8} />
    <Path d="M132 150 C137 166 138 182 137 196" fill="none" {...seam} strokeWidth={2} opacity={0.8} />
    <Path d="M100 176 C91 170 86 165 86 160 C86 155.5 89.5 153 93.5 153 C96.5 153 98.8 155 100 157.5 C101.2 155 103.5 153 106.5 153 C110.5 153 114 155.5 114 160 C114 165 109 170 100 176 Z" fill={WHITE} />
  </Part>
);

export const Paw = ({ size, side }: P & { side: "l" | "r" }) => {
  const x = side === "l" ? 0 : 46;
  return (
    <Part size={size}>
      <G transform={`translate(${x} 0)`}>
        <Rect x={61} y={190} width={32} height={11} rx={4.5} fill={RED} {...seam} strokeWidth={2.2} />
        <Path d="M63 199 Q63 219 77 219 Q91 219 91 199 Z" fill={WHITE} {...line} />
        <Path d="M73 212 L73 218 M81 212 L81 218" {...line} strokeWidth={2} />
      </G>
    </Part>
  );
};

export const Collar = ({ size }: P) => (
  <Part size={size}>
    <Rect x={55} y={126} width={90} height={24} rx={11} fill={RED} {...seam} strokeWidth={2.4} />
    <Path d="M67 131 V145 M78 130 V146 M89 130 V146 M100 130 V146 M111 130 V146 M122 130 V146 M133 131 V145" {...seam} strokeWidth={1.6} opacity={0.65} />
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
