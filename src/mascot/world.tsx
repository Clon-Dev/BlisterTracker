// Where the kitten lives on the home screen and what it does there.
//
// Every home block is wrapped in <MascotSpot>, which reports its position and has a "room" above it (zero height).
// When the kitten settles somewhere, that room opens and pushes the cards below aside; the kitten (and its bubble)
// sit in the room, on the card's top edge, so they never cover anything and scroll with the page. On its way between
// rooms the kitten moves on a layer in front of the cards (or behind them, sneaking), clamped to the visible part of
// the page: when the page scrolls it clings to the screen edge and then climbs to a room in view.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo, Animated, AppState, Easing, Keyboard, Platform, StyleSheet, View,
  type LayoutChangeEvent, type LayoutRectangle, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance,
} from "react-native";
import { useI18n, type Lang, type Strings } from "../i18n";
import { useSheetOpen } from "../sheets";
import { ART_H, ART_W, OUTFITS, type Expression } from "./art";
import {
  idleAction, nextMessage, pickFact, pickMilestone, pickMyth, rememberAnswer, rememberFact, rememberMilestone, SNOOZE, type PillState,
  type STREAK_MILESTONES,
} from "./brain";
import { Bubble, TypingDots, type BubbleContent } from "./Bubble";
import { nyxiAge, specialDay } from "./calendar";
import { FACTS } from "./facts";
import { HERSTORY } from "./herstory";
import { Kitten, type Mode } from "./Kitten";
import { MYTHS } from "./myths";
import { memoryFor, onNoteSaved, updateMemory, useMascotSettings } from "./store";

const nativeDriver = Platform.OS !== "web";
const KW = 90; // 40 % bigger than the first version (64)
/** Movement scales with the kitten: a calmer pace in pixels per millisecond for the bigger body. */
const WALK_MS_PER_PX = 5;
const CLIMB_MS_PER_PX = 3;
const KH = (KW * ART_H) / ART_W;
const SEAT_PAD = 6;
/** Room height a typical bubble needs (a fact with buttons). */
const BUBBLE_ROOM = 170;
const TOPICS = FACTS.map((f) => f.topic);
const factByTag = (tag: string) => FACTS.find((f) => f.tag === tag)!;
const MYTH_TAGS = MYTHS.map((m) => m.tag);
/** Room height that fits the kitten above a block whose own top margin is `inset`. */
const baseRoom = (inset: number) => KH - inset + 6;

// ---------- Scroll (the home ScrollView reports here) ----------

export function useMascotScroll() {
  const scrollY = useRef(new Animated.Value(0)).current;
  const ref = useRef<ScrollViewInstance>(null);
  const listeners = useRef(new Set<(y: number) => void>()).current;
  const [viewport, setViewport] = useState(0);
  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
    useNativeDriver: nativeDriver,
    listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => listeners.forEach((l) => l(e.nativeEvent.contentOffset.y)),
  }), [scrollY, listeners]);
  const onLayout = useCallback((e: LayoutChangeEvent) => setViewport(e.nativeEvent.layout.height), []);
  return { scrollY, ref, listeners, viewport, onScroll, onLayout };
}
export type MascotScroll = ReturnType<typeof useMascotScroll>;

// ---------- Spots and rooms ----------

type Frame = LayoutRectangle & { inset: number };
type Seat = { spot: string; x: number; side: "left" | "right" };

type Registry = { report: (id: string, layout: LayoutRectangle, inset: number) => void; forget: (id: string) => void; room: (id: string) => Animated.Value };
const RegistryContext = createContext<Registry | null>(null);
const SeatContext = createContext<{ seat: Seat | null; render: (inset: number) => React.ReactNode }>({ seat: null, render: () => null });

/** A home block the kitten can sit on (its room opens above it). `inset`: the block's own top margin. */
export function MascotSpot({ id, inset = 16, children }: { id: string; inset?: number; children: React.ReactNode }) {
  const registry = useContext(RegistryContext);
  useEffect(() => () => registry?.forget(id), [registry, id]);
  if (!registry) return <>{children}</>;
  return (
    <View onLayout={(e) => registry.report(id, e.nativeEvent.layout, inset)}>
      <Room id={id} inset={inset} registry={registry} />
      {children}
    </View>
  );
}

function Room({ id, inset, registry }: { id: string; inset: number; registry: Registry }) {
  const { seat, render } = useContext(SeatContext);
  return <Animated.View style={{ height: registry.room(id) }}>{seat?.spot === id && render(inset)}</Animated.View>;
}

// ---------- The kitten's world ----------

/** `render` builds the bubble in the current language, so an open bubble follows a language switch. */
type Message = { key: number; kind: string; render: (t: Strings, lang: Lang) => BubbleContent };

type Props = {
  scroll: MascotScroll;
  /** Device-local day, for the daily memory. */
  day: string;
  /** Today's pill of the own schedule, read when the kitten checks what's due (it turns overdue with time). */
  getPill: () => PillState;
  /** Whether today's pill is marked (null: no own schedule or a pill-free day); the kitten celebrates the change. */
  takenToday: boolean | null;
  hasNoteToday: boolean | null;
  /** The user's username if they chose one (not the automatic personal ID): Nyxi uses it now and then. */
  name: string | null;
  onTakePill: () => void;
  onFocusNote: () => void;
  /** Pills (or on-time actions) in a row, for the streak celebrations; null without an own schedule. */
  streak: { count: number; unit: keyof typeof STREAK_MILESTONES } | null;
  onOpenFactBook: () => void;
  children: React.ReactNode;
};

export function MascotProvider(props: Props) {
  const settings = useMascotSettings();
  if (!settings.enabled) return <>{props.children}</>;
  return <WithoutKittenOnError fallback={props.children}><World {...props} factsEnabled={settings.facts} outfits={settings.outfits} /></WithoutKittenOnError>;
}

/** If the kitten ever fails to render, the home screen carries on without it. */
class WithoutKittenOnError extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/**
 * A line from a pool, addressing the user by `name` about half the time (when there is one). Picked once and rendered
 * per language, so an open bubble shows the same line after a language switch.
 */
function line(plain: (t: Strings) => readonly string[], named: (t: Strings) => readonly ((n: string) => string)[], name: string | null) {
  const useName = !!name && Math.random() < 0.5;
  const r = Math.random();
  return (t: Strings) => {
    if (useName) { const pool = named(t); return pool[Math.floor(r * pool.length)](name!); }
    const pool = plain(t);
    return pool[Math.floor(r * pool.length)];
  };
}

const run = (anim: Animated.CompositeAnimation) => new Promise<boolean>((resolve) => anim.start(({ finished }) => resolve(finished)));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function World({
  scroll, day, getPill, takenToday, hasNoteToday, name, onTakePill, onFocusNote, streak, onOpenFactBook, factsEnabled, outfits, children,
}: Props & { factsEnabled: boolean; outfits: boolean }) {
  const { t, lang } = useI18n();
  const sheetOpen = useSheetOpen();

  // Layout knowledge (refs: read by animations and timers).
  const frames = useRef(new Map<string, Frame>()).current;
  const rooms = useRef(new Map<string, Animated.Value>()).current;
  const roomNow = useRef(new Map<string, number>()).current;
  const layer = useRef({ x: 0, y: 0, width: 0 });
  const scrollNow = useRef(0);
  const [layout, setLayout] = useState(0); // bumps when spots report, to start once everything is measured

  const registry = useMemo<Registry>(() => ({
    report: (id, l, inset) => {
      const prev = frames.get(id);
      frames.set(id, { ...l, inset });
      if (!prev) setLayout((n) => n + 1);
    },
    forget: (id) => {
      frames.delete(id);
      if (seatRef.current?.spot !== id) return;
      setSeat(null); // its block is gone: appear again somewhere else
      setRoaming(null);
      started.current = false;
      setLayout((n) => n + 1);
    },
    room: (id) => {
      let v = rooms.get(id);
      if (!v) {
        v = new Animated.Value(0);
        v.addListener(({ value }) => roomNow.set(id, value));
        rooms.set(id, v);
      }
      return v;
    },
  }), [frames, rooms, roomNow]);

  // Kitten state (state renders; mirrored in refs for timers and animations).
  const [seat, setSeatState] = useState<Seat | null>(null);
  const seatRef = useRef<Seat | null>(null);
  const setSeat = (s: Seat | null) => { seatRef.current = s; setSeatState(s); };
  const [roaming, setRoaming] = useState<"front" | "back" | null>(null); // on a layer instead of in a room
  const [mode, setModeState] = useState<Mode>("sit");
  const modeRef = useRef<Mode>("sit");
  const setMode = (m: Mode) => { modeRef.current = m; setModeState(m); };
  const [facing, setFacing] = useState<-1 | 0 | 1>(0);
  const [expression, setExpression] = useState<Expression>("normal");
  const [talking, setTalking] = useState(false);
  const [hearts, setHearts] = useState(0);
  const [message, setMessageState] = useState<Message | null>(null);
  const messageRef = useRef<Message | null>(null);
  const [bubbleHeight, setBubbleHeight] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [active, setActive] = useState(AppState.currentState === "active");
  const [keyboard, setKeyboard] = useState(false);
  const busy = useRef(false); // travelling or doing an idle trick
  const travel = useRef(0); // id of the current trip; a new trip or scroll cancels older ones
  const lastInteraction = useRef(Date.now());
  const openedAt = useRef(Date.now());
  const programmaticScroll = useRef(false);
  const hiddenToday = memoryFor(day).hidden;

  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const posNow = useRef({ x: 0, y: 0 });
  const roomX = useRef(new Animated.Value(SEAT_PAD)).current;
  const sink = useRef(new Animated.Value(0)).current;
  const squash = useRef(new Animated.Value(1)).current;
  const layerTop = useRef(new Animated.Value(0)).current; // scroll offset in layer coordinates

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion, () => undefined);
    const rm = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    const app = AppState.addEventListener("change", (s) => setActive(s === "active"));
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboard(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboard(false));
    return () => { rm.remove(); app.remove(); show.remove(); hide.remove(); };
  }, []);

  // ----- geometry (layer coordinates) -----
  const roomHeight = (id: string) => roomNow.get(id) ?? 0;
  /** Top-left of the kitten sitting in `id`'s room at `x`, with the room `room` high. */
  const seatPos = (id: string, x: number, room: number) => {
    const f = frames.get(id);
    if (!f) return posNow.current; // the block just unmounted (e.g. moved elsewhere): stay where the kitten is
    return { x: f.x + x - layer.current.x, y: f.y + room + f.inset + 2 - KH - layer.current.y };
  };
  const view = () => ({ top: scrollNow.current - layer.current.y, bottom: scrollNow.current - layer.current.y + scroll.viewport });
  const edgeX = (side: "left" | "right") => (side === "right" ? layer.current.width - KW * 0.62 : -KW * 0.38);
  const setPos = (p: { x: number; y: number }) => { posNow.current = p; pos.setValue(p); };
  const moveTo = (p: { x: number; y: number }, duration: number, easing = Easing.inOut(Easing.quad)) => {
    posNow.current = p;
    return run(Animated.timing(pos, { toValue: p, duration, easing, useNativeDriver: nativeDriver }));
  };

  const openRoom = (id: string, height: number) =>
    Animated.spring(registry.room(id), { toValue: height, useNativeDriver: false, speed: 13, bounciness: 7 }).start();
  const closeRoom = (id: string) =>
    Animated.timing(registry.room(id), { toValue: 0, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: false }).start();

  /** A spot whose room would put the kitten in the upper part of the screen; `need`: room height a bubble needs. */
  const chooseSpot = (except?: string, need = 0) => {
    const top = scrollNow.current;
    let best: string | null = null;
    let bestScore = Infinity;
    frames.forEach((f, id) => {
      if (id === except || f.height === 0) return;
      const kittenTop = f.y + baseRoom(f.inset) + f.inset + 2 - KH;
      const cardTop = f.y + Math.max(baseRoom(f.inset), need) + f.inset;
      if (kittenTop < top + 6 || (need > 0 && f.y < top + 6) || cardTop > top + scroll.viewport - 60) return;
      const score = Math.abs(kittenTop - (top + scroll.viewport * 0.28));
      if (score < bestScore) { bestScore = score; best = id; }
    });
    return best;
  };

  /** Whether the kitten's seat, with a room `need` high, is fully on screen. */
  const seatFits = (s: Seat, need: number) => {
    const f = frames.get(s.spot);
    if (!f) return false;
    const room = Math.max(roomHeight(s.spot), need);
    // The room's top (where a tall bubble starts) and the card edge below it must both be on screen.
    return f.y >= scrollNow.current + 4 && f.y + room + f.inset + 2 - KH >= scrollNow.current + 4
      && f.y + room + f.inset <= scrollNow.current + scroll.viewport - 8;
  };

  /** Steps out of the room onto the layer (same spot on screen), so the room can close. */
  const leaveSeat = (onto: "front" | "back" = "front") => {
    const s = seatRef.current;
    if (!s) return;
    setPos(seatPos(s.spot, s.x, roomHeight(s.spot)));
    setRoaming(onto);
    setSeat(null);
    closeRoom(s.spot);
  };

  const sitDown = (id: string, x: number, side: "left" | "right") => {
    roomX.setValue(x);
    setSeat({ spot: id, x, side });
    setRoaming(null);
    setMode("sit");
    setFacing(0);
  };

  /** Goes to `id`'s room: walking, hopping, climbing along the screen edge, or sneaking behind the cards. */
  const travelTo = async (id: string, style?: "sneak") => {
    if (!frames.get(id) || !scroll.viewport) return;
    const trip = ++travel.current;
    busy.current = true;
    const from = seatRef.current;
    if (from) leaveSeat(style === "sneak" ? "back" : "front");
    if (style === "sneak") await run(Animated.timing(sink, { toValue: KH * 0.9, duration: 320, useNativeDriver: nativeDriver }));
    if (from) await wait(280); // the old room closes; positions below it settle
    if (trip !== travel.current) return;
    const side: "left" | "right" = Math.random() < 0.5 ? "left" : "right";
    const f = frames.get(id);
    if (!f) return lost(); // the target block went away meanwhile
    const x = side === "left" ? SEAT_PAD : f.width - KW - SEAT_PAD;
    const room = baseRoom(f.inset);
    const target = seatPos(id, x, room); // the block's own room doesn't move it, so this holds before it opens
    const start = posNow.current;
    const arrive = () => openRoom(id, room); // opens for the last stretch, pushing the cards aside as it comes

    if (reduceMotion) {
      arrive();
      setPos(target);
    } else if (style === "sneak") {
      arrive();
      setMode("walk");
      await moveTo(target, Math.min(1400, 300 + Math.abs(target.y - start.y) * 2));
      if (trip !== travel.current) return;
      sitDown(id, x, side);
      Animated.spring(sink, { toValue: 0, useNativeDriver: nativeDriver, speed: 10, bounciness: 9 }).start();
      busy.current = false;
      return;
    } else if (Math.abs(target.y - start.y) < 24) {
      arrive();
      setMode("walk");
      setFacing(target.x > start.x ? 1 : -1);
      await moveTo(target, Math.max(320, Math.abs(target.x - start.x) * WALK_MS_PER_PX), Easing.inOut(Easing.sin));
    } else if (Math.abs(target.y - start.y) < 240 && !roamingClinging()) {
      arrive();
      setFacing(target.x > start.x ? 1 : target.x < start.x ? -1 : 0);
      await hop(target);
    } else {
      const edgeSide = target.x > layer.current.width / 2 ? "right" : "left";
      const edge = edgeX(edgeSide);
      setMode("walk");
      setFacing(edgeSide === "right" ? 1 : -1);
      if (Math.abs(start.x - edge) > 4) await moveTo({ x: edge, y: start.y }, Math.max(260, Math.abs(start.x - edge) * WALK_MS_PER_PX), Easing.inOut(Easing.sin));
      if (trip !== travel.current) return;
      setMode("climb");
      setFacing(0);
      await moveTo({ x: edge, y: target.y }, Math.min(1700, Math.max(360, Math.abs(target.y - start.y) * CLIMB_MS_PER_PX)));
      if (trip !== travel.current) return;
      arrive();
      setMode("walk");
      setFacing(edgeSide === "right" ? -1 : 1);
      await moveTo(target, Math.max(320, Math.abs(target.x - edge) * WALK_MS_PER_PX), Easing.inOut(Easing.sin));
    }
    if (trip !== travel.current) return;
    if (!frames.get(id)) return lost();
    sitDown(id, x, side);
    busy.current = false;
  };
  /** The block the kitten was heading for is gone: appear again somewhere else (as when a seat's block unmounts). */
  const lost = () => {
    busy.current = false;
    setSeat(null);
    setRoaming(null);
    started.current = false;
    setLayout((n) => n + 1);
  };
  const roamingClinging = () => modeRef.current === "climb";

  const hop = async (target: { x: number; y: number }) => {
    const start = posNow.current;
    const peak = Math.min(start.y, target.y) - KH * 0.55;
    await run(Animated.timing(squash, { toValue: 0.82, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver })); // crouch
    posNow.current = target;
    squash.setValue(1.08);
    await run(Animated.parallel([
      Animated.timing(pos.x, { toValue: target.x, duration: 640, easing: Easing.linear, useNativeDriver: nativeDriver }),
      Animated.sequence([
        Animated.timing(pos.y, { toValue: peak, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }),
        Animated.timing(pos.y, { toValue: target.y, duration: 340, easing: Easing.in(Easing.quad), useNativeDriver: nativeDriver }),
      ]),
    ]));
    squash.setValue(0.84);
    Animated.spring(squash, { toValue: 1, useNativeDriver: nativeDriver, speed: 14, bounciness: 12 }).start();
  };

  /** Stops a trip in progress (the user scrolled); the kitten stays where it is. */
  const cancelTrip = () => {
    if (!busy.current) return;
    travel.current++;
    busy.current = false;
    pos.stopAnimation((v) => { posNow.current = v as unknown as { x: number; y: number }; });
    sink.setValue(0);
  };

  // ----- appearing, scrolling, settling -----
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = () => {
    if (!started.current || programmaticScroll.current || seatRef.current || busy.current || hiddenToday) return;
    const v = view();
    const p = posNow.current;
    const clamped = { x: p.x, y: Math.min(Math.max(p.y, v.top + 4), v.bottom - KH - 4) };
    setPos(clamped);
    const id = chooseSpot();
    if (id) travelTo(id);
    else { setMode("sit"); setFacing(0); }
  };

  useEffect(() => {
    const onY = (y: number) => {
      scrollNow.current = y;
      lastInteraction.current = Date.now();
      if (modeRef.current === "sleep") setMode("sit");
      const pending = scrollEnd.current;
      if (pending) { // a scroll we started: wait for it to rest
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = setTimeout(pending.then, 180);
        return;
      }
      if (hiddenToday) return;
      const s = seatRef.current;
      if (s) {
        const top = seatPos(s.spot, s.x, roomHeight(s.spot)).y + layer.current.y;
        const middle = top + KH / 2;
        if (middle < y || middle > y + scroll.viewport) {
          leaveSeat();
          setMode("climb");
          setFacing(0);
          const side = s.side;
          moveTo({ x: edgeX(side), y: posNow.current.y }, 260);
        }
      } else if (busy.current) {
        cancelTrip();
        setMode("climb");
      }
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(settle, 700);
    };
    scroll.listeners.add(onY);
    return () => { scroll.listeners.delete(onY); };
  });

  // First appearance: pops up from behind a card in view once the page is measured.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || hiddenToday || !scroll.viewport || layout < 2 || !layer.current.width) return;
    const t0 = setTimeout(() => {
      const id = chooseSpot();
      if (!id || started.current) return;
      started.current = true;
      const f = frames.get(id)!;
      const side = Math.random() < 0.5 ? "left" : "right";
      const x = side === "left" ? SEAT_PAD : f.width - KW - SEAT_PAD;
      openRoom(id, baseRoom(f.inset));
      sink.setValue(reduceMotion ? 0 : KH);
      sitDown(id, x, side);
      if (!reduceMotion) setTimeout(() => Animated.spring(sink, { toValue: 0, useNativeDriver: nativeDriver, speed: 9, bounciness: 10 }).start(), 350);
    }, 900);
    return () => clearTimeout(t0);
  }, [layout, scroll.viewport, hiddenToday]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- messages -----
  const setMessage = (m: Message | null) => { messageRef.current = m; setMessageState(m); if (!m) setBubbleHeight(0); };
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (kind: string, render: Message["render"], autoHide?: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const key = Date.now();
    setMessage({ key, kind, render });
    setTalking(true);
    setTimeout(() => setTalking(false), Math.min(1800, 400 + render(t, lang).text.length * 22));
    if (autoHide) hideTimer.current = setTimeout(() => { if (messageRef.current?.key === key) setMessage(null); }, autoHide);
  };
  const quiet = () => setMessage(null);

  const declined = quiet;

  const showFact = () => {
    const index = pickFact(TOPICS, memoryFor(day));
    const fact = FACTS[index];
    // To find the fact behind a bubble (e.g. to fix a translation): browser console, or `nyxiFact` there.
    console.info(`[Nyxi] fact FACTS[${index}] tag "${fact.tag}" (src/mascot/facts.ts)`);
    (globalThis as { nyxiFact?: unknown }).nyxiFact = { index, ...fact };
    updateMemory(day, (mem) => rememberFact(mem, index, fact.topic, FACTS.length));
    say("fact", (t, lang) => ({
      title: t.mascotFactTitle, text: fact[lang], source: { name: fact.source, url: fact.url, label: t.mascotSource },
      buttons: [{ label: t.mascotFactMore, onPress: showFact }, { label: t.mascotFactThanks, primary: true, onPress: declined }],
    }));
  };

  const cheer = (ms = 1300) => {
    setHearts((h) => h + 1);
    setExpression("happy");
    setTimeout(() => setExpression("normal"), ms);
  };

  // The tap menu: what Nyxi can do, right there.
  const showMenu = () => {
    const purr = line((t) => t.mascotPurr, (t) => t.mascotPurrNamed, name);
    say("menu", (t) => ({
      text: `${purr(t)} ${t.mascotMenu}`,
      buttons: [
        { label: t.mascotMenuFact, primary: true, onPress: showFact },
        { label: t.mascotMenuQuiz, onPress: showQuiz },
        { label: t.mascotMenuHerstory, onPress: showHerstory },
        { label: t.mascotMenuPet, onPress: petMe },
        { label: t.mascotMenuBook, onPress: () => { quiet(); onOpenFactBook(); } },
      ],
    }));
  };

  /** "Myth or fact?": a statement, then the answer with the deciding fact and its source. */
  const showQuiz = () => {
    const tag = pickMyth(MYTH_TAGS, memoryFor(day));
    const myth = MYTHS.find((m) => m.tag === tag)!;
    console.info(`[Nyxi] myth "${tag}" (src/mascot/myths.ts)`);
    const answer = (guess: "myth" | "fact") => {
      const right = guess === myth.answer;
      updateMemory(day, (mem) => rememberAnswer(mem, tag, right, MYTHS.length));
      const n = memoryFor(day).quizStreak ?? 0;
      if (right) cheer(1800);
      const verdict = right ? line((t) => t.mascotQuizRight, (t) => t.mascotQuizRight.map((x) => () => x), null) : line((t) => t.mascotQuizWrong, (t) => t.mascotQuizWrong.map((x) => () => x), null);
      const fact = factByTag(tag);
      say("quizAnswer", (t, lang) => ({
        title: `${verdict(t)} ${t.mascotQuizIs({ myth: myth.answer === "myth" })}`,
        text: `${fact[lang]}${right && n >= 3 ? ` ${t.mascotQuizStreak({ n })}` : ""}`,
        source: { name: fact.source, url: fact.url, label: t.mascotSource },
        buttons: [{ label: t.mascotQuizNext, onPress: showQuiz }, { label: t.mascotFactThanks, primary: true, onPress: quiet }],
      }));
    };
    say("quiz", (t, lang) => ({
      title: t.mascotQuizTitle, text: lang === "de" ? `„${myth.de}“` : `“${myth.en}”`,
      buttons: [{ label: t.mascotMyth, primary: true, onPress: () => answer("myth") }, { label: t.mascotFact, primary: true, onPress: () => answer("fact") }],
    }));
  };

  /** A milestone in women's history; one that happened on today's date first. */
  const showHerstory = () => {
    const monthDay = day.slice(5);
    const tag = pickMilestone(HERSTORY, monthDay, memoryFor(day));
    const item = HERSTORY.find((h) => h.tag === tag)!;
    console.info(`[Nyxi] herstory "${tag}" (src/mascot/herstory.ts)`);
    updateMemory(day, (mem) => rememberMilestone(mem, tag, HERSTORY.length));
    say("herstory", (t, lang) => ({
      title: item.date === monthDay ? t.mascotOnThisDay : t.mascotHerstoryTitle, text: item[lang],
      source: { name: item.source, url: item.url, label: t.mascotSource },
      buttons: [{ label: t.mascotFactMore, onPress: showHerstory }, { label: t.mascotFactThanks, primary: true, onPress: quiet }],
    }));
  };

  const petMe = () => {
    lastInteraction.current = Date.now();
    cheer();
    const purr = line((t) => t.mascotPurr, (t) => t.mascotPurrNamed, name);
    say("purr", (t) => ({ text: purr(t) }), 2000);
  };

  // Reacting to a saved note: happy with a happy mood, gentle with a sad one.
  useEffect(() => onNoteSaved((mood) => {
    if (hiddenToday) return;
    const happy = mood === "😄" || mood === "🙂";
    const sad = mood === "😕" || mood === "😣";
    if (happy) cheer(2200);
    const pool = (t: Strings) => (happy ? t.mascotNoteHappy : sad ? t.mascotNoteSad : t.mascotNoteOkay);
    const text = line(pool, (t) => pool(t).map((x) => () => x), null);
    setTimeout(() => say("note", (t) => ({ text: text(t) }), 3200), 600);
  }), [hiddenToday]); // eslint-disable-line react-hooks/exhaustive-deps

  // Today's outfit (special days, if switched on); remembered for the wardrobe.
  const special = outfits ? specialDay(day) : null;
  const crown = memoryFor(day).crownDay === day;
  useEffect(() => {
    const id = special?.id ?? "everyday";
    if (!memoryFor(day).outfits?.includes(id)) updateMemory(day, (m) => ({ ...m, outfits: [...(m.outfits ?? []), id] }));
  }, [special?.id, day]);

  /** Runs `then` once a scroll we started has come to rest (no scroll events for a moment). */
  const scrollEnd = useRef<{ timer: ReturnType<typeof setTimeout> | null; then: () => void } | null>(null);
  const afterProgrammaticScroll = (then: () => void) => {
    programmaticScroll.current = true;
    const finish = () => { scrollEnd.current = null; programmaticScroll.current = false; then(); };
    scrollEnd.current = { timer: setTimeout(finish, 600), then: finish };
  };
  const openNotes = () => {
    quiet();
    const f = frames.get("note");
    if (!f) { onFocusNote(); return; }
    cancelTrip();
    afterProgrammaticScroll(() => {
      onFocusNote(); // focusing may scroll a little more on the web
      afterProgrammaticScroll(() => { if (seatRef.current?.spot !== "note") travelTo("note"); });
    });
    scroll.ref.current?.scrollTo({ y: Math.max(0, f.y - 120), animated: true });
  };

  // What's due: checked every few seconds while sitting quietly.
  useEffect(() => {
    if (!active || hiddenToday) return;
    const tick = () => {
      const s = seatRef.current;
      if (!s || busy.current || messageRef.current || sheetOpen || keyboard || programmaticScroll.current) return;
      const m = memoryFor(day);
      const now = Date.now();
      const due = nextMessage({
        now, hour: new Date().getHours(), openedFor: now - openedAt.current, pill: getPill(), hasNoteToday, factsEnabled,
        special: special?.id ?? null, year: Number(day.slice(0, 4)), streak: streak ?? undefined,
      }, m);
      if (!due) return;
      if (!seatFits(s, BUBBLE_ROOM)) { // move somewhere the bubble fits on screen first; speak on a later tick
        const id = chooseSpot(s.spot, BUBBLE_ROOM);
        if (id) travelTo(id);
        return;
      }
      if (due.kind === "reminder") {
        updateMemory(day, (mem) => ({ ...mem, greeted: true }));
        const action = due.action as keyof Strings["mascotActionReminder"] | undefined;
        say("reminder", (t) => ({
          text: action ? t.mascotActionReminder[action] : due.late ? t.mascotReminderLate({ n: due.number }) : t.mascotReminder({ n: due.number }),
          buttons: [
            { label: action ? t.mascotDone : t.mascotTaken, primary: true, onPress: () => { quiet(); onTakePill(); } },
            { label: t.mascotLater, onPress: () => { updateMemory(day, (mem) => ({ ...mem, snoozeUntil: Date.now() + SNOOZE })); quiet(); } },
          ],
        }));
      } else if (due.kind === "greet") {
        updateMemory(day, (mem) => ({ ...mem, greeted: true, introduced: true, saidGoodnight: mem.saidGoodnight || (due.part === "night" && !due.intro) }));
        const text = line((t) => t.mascotGreet[due.part], (t) => t.mascotGreetNamed[due.part], name);
        say("greet", (t) => ({ text: due.intro ? t.mascotIntro : text(t) }), due.intro ? 4500 : 3200);
      } else if (due.kind === "soon") {
        updateMemory(day, (mem) => ({ ...mem, soonSaid: true }));
        say("soon", (t) => ({ text: t.mascotSoon({ days: due.days }) }), 5000);
      } else if (due.kind === "goodnight") {
        updateMemory(day, (mem) => ({ ...mem, saidGoodnight: true }));
        const text = line((t) => t.mascotGreet.night, (t) => t.mascotGreetNamed.night, name);
        say("goodnight", (t) => ({ text: text(t) }), 3800);
        setExpression("sleepy");
        setTimeout(() => setExpression("normal"), 3800);
      } else if (due.kind === "special") {
        const sp = specialDay(day)!;
        // Counts as today's fact, so no automatic one follows.
        updateMemory(day, (mem) => ({ ...mem, greeted: true, autoFact: mem.autoFact || !!sp.item, special: { ...mem.special, [sp.id]: Number(day.slice(0, 4)) } }));
        const fact = sp.item?.kind === "fact" ? factByTag(sp.item.tag) : null;
        const milestone = sp.item?.kind === "herstory" ? HERSTORY.find((h) => h.tag === sp.item!.tag)! : null;
        if (milestone) updateMemory(day, (mem) => rememberMilestone(mem, milestone.tag, HERSTORY.length));
        if (fact) updateMemory(day, (mem) => ({ ...mem, found: mem.found?.includes(FACTS.indexOf(fact)) ? mem.found : [...(mem.found ?? []), FACTS.indexOf(fact)] }));
        cheer(2400);
        const item = fact ?? milestone;
        say("special", (t, lang) => ({
          title: sp.id === "birthday" ? t.mascotBirthday({ age: nyxiAge(day) }) : t.mascotSpecial[sp.id],
          text: item ? item[lang] : "",
          ...(item ? { source: { name: item.source, url: item.url, label: t.mascotSource } } : {}),
          buttons: [{ label: t.mascotFactThanks, primary: true, onPress: quiet }],
        }), 11_000); // closes by itself so it never holds up a reminder or the mood question (it's in the fact book)
      } else if (due.kind === "streak") {
        updateMemory(day, (mem) => ({ ...mem, streakSeen: due.days, crownDay: day }));
        cheer(3000);
        say("streak", (t) => ({ text: t.mascotStreak({ n: due.days, pill: streak?.unit === "pill" }) }), 5000);
      } else if (due.kind === "mood") {
        updateMemory(day, (mem) => ({ ...mem, moodAsked: true }));
        say("mood", (t) => ({ text: t.mascotMood, buttons: [{ label: t.mascotMoodYes, primary: true, onPress: openNotes }, { label: t.mascotMoodNo, onPress: quiet }] }));
      } else {
        showFact();
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }); // re-armed on every render: the tick reads the latest props

  // Celebrate when today's pill gets marked (any path).
  const wasTaken = useRef(takenToday);
  useEffect(() => {
    const before = wasTaken.current;
    wasTaken.current = takenToday;
    if (!takenToday || before !== false) return;
    if (messageRef.current?.kind === "reminder") quiet();
    setExpression("happy");
    setHearts((h) => h + 1);
    if (!reduceMotion) Animated.sequence([
      Animated.timing(squash, { toValue: 0.85, duration: 120, useNativeDriver: nativeDriver }),
      Animated.spring(squash, { toValue: 1, useNativeDriver: nativeDriver, speed: 12, bounciness: 14 }),
    ]).start();
    const yay = line((t) => t.mascotYay, (t) => t.mascotYayNamed, name);
    say("yay", (t) => ({ text: yay(t) }), 2800);
    const id = setTimeout(() => setExpression("normal"), 2800);
    return () => clearTimeout(id);
  }, [takenToday]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- idle tricks -----
  useEffect(() => {
    if (!active || hiddenToday || reduceMotion) return;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => { timer = setTimeout(act, 22_000 + Math.random() * 33_000); };
    const act = async () => {
      const s = seatRef.current;
      if (!s || busy.current || messageRef.current || modeRef.current === "sleep") return next();
      const action = idleAction(Date.now() - lastInteraction.current);
      busy.current = true;
      if (action === "nap") {
        setMode("sleep");
      } else if (action === "stroll") {
        const f = frames.get(s.spot);
        if (f) {
          const side = s.side === "left" ? "right" : "left";
          const x = side === "left" ? SEAT_PAD : f.width - KW - SEAT_PAD;
          setMode("walk");
          setFacing(x > s.x ? 1 : -1);
          await run(Animated.timing(roomX, { toValue: x, duration: Math.abs(x - s.x) * 10, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver }));
          if (seatRef.current?.spot === s.spot) { setSeat({ spot: s.spot, x, side }); setMode("sit"); setFacing(0); }
        }
      } else if (action === "peek") {
        await run(Animated.timing(sink, { toValue: KH * 0.72, duration: 340, easing: Easing.in(Easing.quad), useNativeDriver: nativeDriver }));
        await wait(1200);
        setExpression("surprised");
        await run(Animated.spring(sink, { toValue: 0, useNativeDriver: nativeDriver, speed: 12, bounciness: 10 }));
        setTimeout(() => setExpression("normal"), 700);
      } else if (action === "groom") {
        await run(Animated.timing(squash, { toValue: 1.07, duration: 420, useNativeDriver: nativeDriver }));
        await run(Animated.spring(squash, { toValue: 1, useNativeDriver: nativeDriver, speed: 8, bounciness: 10 }));
      } else {
        const id = chooseSpot(s.spot);
        busy.current = false;
        if (id) await travelTo(id, Math.random() < 0.35 ? "sneak" : undefined);
      }
      busy.current = false;
      next();
    };
    next();
    return () => clearTimeout(timer);
  }, [active, hiddenToday, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- touching the kitten -----
  const pet = () => {
    lastInteraction.current = Date.now();
    if (modeRef.current === "sleep") {
      setMode("sit");
      setExpression("surprised");
      setTimeout(() => setExpression("normal"), 800);
      return;
    }
    if (!memoryFor(day).tapped) updateMemory(day, (m) => ({ ...m, tapped: true }));
    cheer();
    // A tap opens the menu; tapping again while it's open is a pat on the head.
    // Important questions (a reminder, the mood, a quiz waiting for an answer, hiding) stay until answered.
    const kind = messageRef.current?.kind;
    if (kind === "menu") petMe();
    else if (kind !== "reminder" && kind !== "mood" && kind !== "quiz" && kind !== "hide") showMenu();
  };
  const askHide = () => {
    lastInteraction.current = Date.now();
    say("hide", (t) => ({
      text: t.mascotHide,
      buttons: [
        { label: t.mascotHideYes, onPress: async () => {
          quiet();
          updateMemory(day, (m) => ({ ...m, hidden: true }));
          await run(Animated.timing(sink, { toValue: KH, duration: 380, useNativeDriver: nativeDriver }));
          const s = seatRef.current;
          if (s) closeRoom(s.spot);
          setSeat(null);
          setRoaming(null);
        } },
        { label: t.mascotHideNo, primary: true, onPress: quiet },
      ],
    }));
  };

  // The room grows to fit the bubble; it shrinks back when the bubble goes.
  const showBubble = !!message && !sheetOpen && !keyboard;
  useEffect(() => {
    if (!seat) return;
    const f = frames.get(seat.spot);
    if (!f) return;
    const needed = showBubble && bubbleHeight ? Math.max(baseRoom(f.inset), bubbleHeight - f.inset + 14) : baseRoom(f.inset);
    openRoom(seat.spot, needed);
  }, [seat?.spot, bubbleHeight, showBubble]); // eslint-disable-line react-hooks/exhaustive-deps

  const kitten = (
    <Kitten size={KW} mode={mode} facing={facing} expression={expression} talking={talking} hearts={hearts}
      active={active} reduceMotion={reduceMotion} label={t.mascotLabel} onPress={pet} onLongPress={askHide} onStroke={petMe}
      outfit={OUTFITS[special?.id ?? "everyday"]} crown={crown} badge={!memoryFor(day).tapped || (factsEnabled && !memoryFor(day).autoFact)} />
  );
  const squashStyle = { transformOrigin: "50% 100%", transform: [{ scaleY: squash }, { scaleX: squash.interpolate({ inputRange: [0.8, 1, 1.2], outputRange: [1.12, 1, 0.92] }) }] };

  const seatValue = useMemo(() => ({
    seat,
    render: (inset: number) => {
      if (!seat) return null;
      const f = frames.get(seat.spot);
      const width = f?.width ?? 0;
      return (
        <>
          <Animated.View style={[{ position: "absolute", left: 0, bottom: -(inset + 2), transform: [{ translateX: roomX }, { translateY: sink }] }]}>
            <Animated.View style={squashStyle}>{kitten}</Animated.View>
          </Animated.View>
          {showBubble && message && (
            <View style={[{ position: "absolute", bottom: -(inset - 6), maxWidth: Math.min(300, Math.max(160, width - KW - SEAT_PAD * 2 - 14)) },
              seat.side === "left" ? { left: SEAT_PAD + KW + 12 } : { right: SEAT_PAD + KW + 12 }]}>
              <Bubble key={message.key} content={message.render(t, lang)} kittenSide={seat.side} onHeight={setBubbleHeight} />
            </View>
          )}
        </>
      );
    },
  }), [seat, mode, facing, expression, talking, hearts, active, reduceMotion, message, showBubble, lang, special?.id, crown]); // eslint-disable-line react-hooks/exhaustive-deps

  // On a layer: clamped to the visible part of the page (computed natively while scrolling).
  const layerY = useMemo(() => {
    const top = Animated.subtract(scroll.scrollY, layerTop);
    if (scroll.viewport < KH + 16) return pos.y;
    const rel = Animated.subtract(pos.y, top).interpolate({
      inputRange: [4, scroll.viewport - KH - 4], outputRange: [4, scroll.viewport - KH - 4], extrapolate: "clamp",
    });
    return Animated.add(top, rel);
  }, [scroll.scrollY, scroll.viewport, pos.y, layerTop]);

  const onLayerLayout = (e: LayoutChangeEvent) => {
    const { x, y, width } = e.nativeEvent.layout;
    layer.current = { x, y, width };
    layerTop.setValue(y);
    setLayout((n) => n + 1);
  };
  const roamer = (where: "front" | "back") => roaming === where && !hiddenToday && (
    <Animated.View style={[st.roamer, { transform: [{ translateX: pos.x }, { translateY: layerY }, { translateY: sink }] }]}>
      <Animated.View style={squashStyle}>{kitten}</Animated.View>
      {message && <View style={st.dots}><TypingDots /></View>}
    </Animated.View>
  );

  return (
    <RegistryContext.Provider value={registry}>
      <SeatContext.Provider value={seatValue}>
        <View pointerEvents="box-none" style={st.layer}>{roamer("back")}</View>
        {children}
        <View pointerEvents="box-none" style={[st.layer, st.front]} onLayout={onLayerLayout}>{roamer("front")}</View>
      </SeatContext.Provider>
    </RegistryContext.Provider>
  );
}

const st = StyleSheet.create({
  layer: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  front: { zIndex: 50, elevation: 50 },
  roamer: { position: "absolute", left: 0, top: 0 },
  dots: { position: "absolute", left: -34, top: KH * 0.12 },
});
