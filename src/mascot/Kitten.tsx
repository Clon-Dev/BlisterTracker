// The kitten puppet: drawing parts on animated layers (pivots in the 200×236 art box), idle life, walk and climb cycles.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from "react-native";
import { ART_H, ART_W, Blush, Body, ClosedEyes, Collar, Ear, Eyes, Haunch, Head, Muzzle, Paw, Shadow, Tail, type Expression, type Mouth } from "./art";

const nativeDriver = Platform.OS !== "web";
const fill = StyleSheet.absoluteFill;
/** Pivot for rotations, as a percentage of the art box. */
const origin = (x: number, y: number) => ({ transformOrigin: `${(x / ART_W) * 100}% ${(y / ART_H) * 100}%` });

export type Mode = "sit" | "walk" | "climb" | "sleep";

type Props = {
  size: number;
  mode: Mode;
  /** -1 left, 0 front, 1 right: the face slides toward where it's going. */
  facing: -1 | 0 | 1;
  expression: Expression;
  talking: boolean;
  /** Increment to let a few hearts float up. */
  hearts: number;
  /** False pauses the idle loops (app in the background, kitten hidden). */
  active: boolean;
  reduceMotion: boolean;
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
};

/** Runs `make()` as an endless animation while `on`; stops and resets when off. */
function useLoop(on: boolean, make: () => Animated.CompositeAnimation, deps: unknown[]) {
  useEffect(() => {
    if (!on) return;
    const anim = make();
    anim.start();
    return () => anim.stop();
  }, [on, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
}

const timing = (v: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
  Animated.timing(v, { toValue, duration, easing, useNativeDriver: nativeDriver });

export function Kitten({ size, mode, facing, expression, talking, hearts, active, reduceMotion, label, onPress, onLongPress }: Props) {
  const k = size / ART_W;
  const height = (size * ART_H) / ART_W;
  const v = useRef({
    cycle: new Animated.Value(0), blink: new Animated.Value(1), breathe: new Animated.Value(0), tail: new Animated.Value(0),
    look: new Animated.Value(0), ear: new Animated.Value(0), facing: new Animated.Value(facing),
  }).current;
  const moving = mode === "walk" || mode === "climb";
  const lively = active && !reduceMotion;

  // Idle life. The walk/climb cycle drives paws, legs and the body bob.
  useLoop(lively && moving, () => {
    v.cycle.setValue(0);
    return Animated.loop(timing(v.cycle, 1, mode === "climb" ? 440 : 520, Easing.linear));
  }, [mode]);
  useLoop(active && mode !== "sleep", () => Animated.loop(Animated.sequence([
    Animated.delay(2600 + Math.random() * 2400), timing(v.blink, 0.08, 70), timing(v.blink, 1, 90),
  ])), []);
  useLoop(lively, () => Animated.loop(Animated.sequence([timing(v.breathe, 1, mode === "sleep" ? 1900 : 1600), timing(v.breathe, 0, mode === "sleep" ? 1900 : 1600)])), [mode]);
  useLoop(lively && mode !== "sleep", () => Animated.loop(Animated.sequence([timing(v.tail, 1, moving ? 260 : 1300), timing(v.tail, 0, moving ? 260 : 1300)])), [moving]);
  useLoop(lively && mode === "sit" && !talking, () => Animated.loop(Animated.sequence([
    Animated.delay(3500), timing(v.look, -1, 500), Animated.delay(1400), timing(v.look, 0.8, 650), Animated.delay(1200), timing(v.look, 0, 500),
  ])), [talking]);
  useLoop(lively && mode !== "sleep", () => Animated.loop(Animated.sequence([
    Animated.delay(4800), timing(v.ear, 1, 80), timing(v.ear, -0.35, 80), timing(v.ear, 0, 90),
  ])), []);
  useEffect(() => { Animated.spring(v.facing, { toValue: facing, useNativeDriver: nativeDriver, speed: 14, bounciness: 4 }).start(); }, [facing, v]);
  useEffect(() => { if (!moving) v.cycle.setValue(0); }, [moving, v]);
  useEffect(() => { if (mode === "sleep" || !lively) v.look.setValue(0); }, [mode, lively, v]);

  // Mouth: chatters while talking.
  const [mouthOpen, setMouthOpen] = useState(false);
  useEffect(() => {
    if (!talking) { setMouthOpen(false); return; }
    const id = setInterval(() => setMouthOpen((o) => !o), 170);
    return () => clearInterval(id);
  }, [talking]);
  const mouth: Mouth = expression === "happy" ? "open" : expression === "surprised" ? "o" : mouthOpen ? "open" : "smile";

  const amp = (mode === "climb" ? 9 : 6) * k;
  const step = (phase: 0 | 0.5) => ({
    translateY: v.cycle.interpolate({ inputRange: phase === 0 ? [0, 0.25, 0.5, 1] : [0, 0.5, 0.75, 1], outputRange: [0, phase === 0 ? -amp : 0, phase === 0 ? 0 : -amp, 0] }),
  });
  const bob = v.cycle.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -2.5 * k, 0, -2.5 * k, 0] });
  const faceX = Animated.add(Animated.multiply(v.facing, 9 * k), Animated.multiply(v.look, 7 * k));
  const earsX = Animated.multiply(v.facing, 4 * k);
  const breatheY = v.breathe.interpolate({ inputRange: [0, 1], outputRange: [1, mode === "sleep" ? 0.965 : 0.985] });
  const breatheX = v.breathe.interpolate({ inputRange: [0, 1], outputRange: [1, mode === "sleep" ? 1.025 : 1.012] });

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={450} accessibilityRole="button" accessibilityLabel={label}
      style={{ width: size, height }} hitSlop={8}>
      <Shadow size={size} />
      <Animated.View style={[fill, { transform: [{ translateY: bob }] }]}>
        <Animated.View style={[fill, origin(150, 206), { transform: [{ rotate: v.tail.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-12deg"] }) }] }]}>
          <Tail size={size} />
        </Animated.View>
        <Animated.View style={[fill, { transform: [step(0.5)] }]}><Haunch size={size} side="l" /></Animated.View>
        <Animated.View style={[fill, { transform: [step(0)] }]}><Haunch size={size} side="r" /></Animated.View>
        <Animated.View style={[fill, origin(100, 206), { transform: [{ scaleX: breatheX }, { scaleY: breatheY }] }]}><Body size={size} /></Animated.View>
        <Animated.View style={[fill, { transform: [step(0)] }]}><Paw size={size} side="l" /></Animated.View>
        <Animated.View style={[fill, { transform: [step(0.5)] }]}><Paw size={size} side="r" /></Animated.View>
        <Collar size={size} />
        <Animated.View style={[fill, origin(100, 132), {
          transform: [{ rotate: v.look.interpolate({ inputRange: [-1, 0, 1], outputRange: ["-6deg", "0deg", "6deg"] }) }],
        }]}>
          <Animated.View style={[fill, { transform: [{ translateX: earsX }] }]}>
            <Animated.View style={[fill, origin(56, 40), { transform: [{ rotate: v.ear.interpolate({ inputRange: [-1, 1], outputRange: ["-9deg", "9deg"] }) }] }]}>
              <Ear size={size} side="l" />
            </Animated.View>
            <Animated.View style={[fill, origin(144, 40), { transform: [{ rotate: v.ear.interpolate({ inputRange: [-1, 1], outputRange: ["9deg", "-9deg"] }) }] }]}>
              <Ear size={size} side="r" />
            </Animated.View>
          </Animated.View>
          <Head size={size} />
          <Animated.View style={[fill, { transform: [{ translateX: faceX }] }]}>
            {expression === "happy" || expression === "sleepy" || mode === "sleep"
              ? <ClosedEyes size={size} kind={expression === "happy" ? "happy" : "sleepy"} />
              : <Animated.View style={[fill, origin(100, 80), { transform: [{ scaleY: v.blink }] }]}><Eyes size={size} /></Animated.View>}
            {expression === "happy" && <Blush size={size} />}
            <Muzzle size={size} mouth={mode === "sleep" ? "smile" : mouth} />
          </Animated.View>
        </Animated.View>
      </Animated.View>
      {mode === "sleep" && lively && <Snore size={size} />}
      <Hearts burst={hearts} size={size} />
    </Pressable>
  );
}

/** "z z" floating up while asleep. */
function Snore({ size }: { size: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(timing(t, 1, 2200, Easing.out(Easing.quad)));
    anim.start();
    return () => anim.stop();
  }, [t]);
  return (
    <Animated.Text pointerEvents="none" style={{
      position: "absolute", right: -size * 0.08, top: size * 0.02, fontSize: size * 0.22, fontWeight: "800", color: "#9A8AA8",
      opacity: t.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] }),
      transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.3] }) }, { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, size * 0.12] }) }],
    }}>z</Animated.Text>
  );
}

/** A few hearts floating up from the kitten each time `burst` increments. */
function Hearts({ burst, size }: { burst: number; size: number }) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (!burst) return;
    values.forEach((h) => h.setValue(0));
    Animated.stagger(180, values.map((h) => timing(h, 1, 1300, Easing.out(Easing.quad)))).start();
  }, [burst, values]);
  if (!burst) return null;
  return (
    <View pointerEvents="none" style={fill}>
      {values.map((h, i) => (
        <Animated.Text key={i} style={{
          position: "absolute", left: size * [0.12, 0.62, 0.38][i], top: size * 0.1, fontSize: size * [0.2, 0.17, 0.24][i], color: "#E8577A",
          opacity: h.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateY: h.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.75] }) }, { scale: h.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.1] }) }],
        }}>♥</Animated.Text>
      ))}
    </View>
  );
}
