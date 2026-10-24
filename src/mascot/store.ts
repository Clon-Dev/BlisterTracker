// The kitten's settings and memory, per device (AsyncStorage), like the appearance and language choices.
import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { forDay, freshMemory, type Memory } from "./brain";

export type MascotSettings = { enabled: boolean; facts: boolean; /** Outfits on special days. */ outfits: boolean };
type State = { settings: MascotSettings; memory: Memory };

const KEY = "mascot";
let state: State = { settings: { enabled: true, facts: true, outfits: true }, memory: freshMemory("") };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => undefined);
}

export async function loadMascot() {
  const saved = await AsyncStorage.getItem(KEY).catch(() => null);
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved) as Partial<State>;
    state = { settings: { ...state.settings, ...parsed.settings }, memory: { ...state.memory, ...parsed.memory } };
    listeners.forEach((l) => l());
  } catch { /* unreadable: keep the defaults */ }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSettings = () => state.settings;

export const useMascotSettings = () => useSyncExternalStore(subscribe, getSettings, getSettings);
export const setMascotSettings = (patch: Partial<MascotSettings>) => set({ ...state, settings: { ...state.settings, ...patch } });

/** The memory for `day` (daily counters reset on a new day). */
export const memoryFor = (day: string) => forDay(state.memory, day);
export const updateMemory = (day: string, change: (m: Memory) => Memory) => set({ ...state, memory: change(forDay(state.memory, day)) });

/** The whole memory (the fact book reads what was discovered). */
export const useMascotMemory = () => useSyncExternalStore(subscribe, getMemory, getMemory);
const getMemory = () => state.memory;

// A note was saved (with this mood): Nyxi reacts on the home screen.
type NoteListener = (mood: string | null) => void;
const noteListeners = new Set<NoteListener>();
export const onNoteSaved = (l: NoteListener) => { noteListeners.add(l); return () => { noteListeners.delete(l); }; };
export const noteSaved = (mood: string | null) => noteListeners.forEach((l) => l(mood));
