# Blister Buddy design guidelines

These are the conventions the app already follows, written down so new screens fit in (first written for the follower
management screen). Change this file when a convention changes.

## Look and feel
- **Mood:** warm, soft and friendly. A pink-to-plum palette, rounded shapes, gentle shadows. Calm rather than clinical,
  never alarming unless something needs attention.
- **Font:** Plus Jakarta Sans everywhere, through `F.regular/medium/semibold/bold/extrabold` (`src/theme.ts`). Never
  `fontWeight` alone: on Android it doesn't pick the right font file.
- **Dark mode:** every colour comes from the palette `C` in `src/theme.ts`, which has a light and a dark version.
  Styles are built with `themedStyles(() => ({ … }))` so they rebuild on a theme switch. No hex colours in screens,
  except for Nyxi's drawing (`src/mascot/art.tsx`, `looks.ts`).

## Tokens (`src/theme.ts`)
- **Colours:**
  - `C.bg`: page; `C.card`: cards; `C.border`: dividers and outlines.
  - Text: `C.text`, `C.textSoft` (secondary), `C.muted` (labels, captions), `C.placeholder`.
  - Brand: `C.primary`, `C.primaryDeep` (text and icons on light surfaces), `C.primarySoft` (soft fills, icon circles),
    `C.primaryTint` (pressed or highlighted).
  - Status: `C.success`, `C.warning`, `C.danger`, each with a `…Soft` background.
- **Gradients:** `G.primary` (buttons, small icon tiles), `G.hero` (the big status card), `G.avatar` (people).
- **Radii:** `R.sm 12 · R.md 16 · R.lg 22 · R.xl 28 · R.full`. Cards use `R.lg`, hero cards `R.xl`, chips and pills `R.full`.
- **Elevation:** `shadow(1)` for cards and selected items, `shadow(2)` for primary buttons, `shadow(3)` for hero cards and
  floating elements.

## Typography (`s` in `src/ui.tsx`)
| Style | Use |
|---|---|
| `s.title` 30/800 | the screen title on auth screens |
| `s.h1` 24/800 | sheet titles, hero headline |
| `s.h2` 18/700 | card titles, a person's name |
| `s.body` 15/500 | normal text |
| `s.muted` 14/500 | explanations under titles |
| `s.small` 13/500 | secondary lines, hints, captions |
| `s.label` 13/600 | field labels |
| `s.eyebrow` 12/700 caps | small section labels inside cards ("YOUR USERNAME") |

## Building blocks (`src/ui.tsx`, `src/sheets.tsx`)
- **Screen:** `<Header title subtitle onBack />` at the top (back chevron, title, one-line subtitle), then `Card`s. Use
  `SectionTitle` between groups of cards. One topic per card.
- **Card:** `C.card`, `R.lg`, a 1 px `C.cardEdge` border, 20 px padding, 16 px apart. A card with actions ends with a 1 px divider (`C.border`,
  14 px margin) and a row of `LinkButton`s (e.g. History · Unfollow, Remove · Block).
- **Buttons:**
  - `primary`: the one main action of a screen or sheet; full width, at the bottom.
  - `secondary`: other actions.
  - `ghost`: cancel and back.
  - `danger`: destructive confirmations.
  - `light`: on gradients.
  - `compact` inside cards. `LinkButton` for small inline actions; its colour is `C.textSoft` for neutral and `C.danger`
    for destructive ones.
- **IconButton:** round, `C.primarySoft`, for tools next to content (edit, copy, history). Always with an accessible `label`.
- **Badge:** status pills (`success`, `primary`, `danger`, `neutral`, `glass` on gradients).
- **Choices:** `ChipGroup` for a few options, `Toggle` for on/off (it exposes `aria-checked`), `Stepper` for numbers,
  `DatePicker` and `TimeDial` for dates and times.
- **People:** a 46 px round `G.avatar` gradient with the first letter (white, 800), the name in `s.h2`, one `s.small` line
  below (e.g. "Following since 3 November 2026"). Blocked people use a grey avatar and `C.textSoft` name.
- **Icons:** Lucide only. 18–20 px at 2.3–2.4 stroke in cards, 26 px in sheet icons. Each icon gets a meaning that stays
  the same across the app:
  - `UserPlus` follow; `UserMinus` unfollow or remove; `Ban` block; `ShieldCheck` unblock.
  - `Users` followers; `CalendarDays` history; `Pencil` edit; `Copy` copy; `KeyRound` sharing password; `FileDown` export.

## Feedback and flow
- **Sheets instead of system dialogs:**
  - `confirm({ title, message, confirmLabel, destructive, icon })` asks before anything destructive or hard to undo:
    unfollow, remove follower, block, delete. The title is a question naming the person or thing ("Remove Lina?"). The
    message says what will happen and how to undo it. The confirm label is the plain verb ("Remove", "Block").
  - `alert()` is only for errors and things that can't proceed. `openSheet()` is for custom sheets (pickers, notes),
    with `SheetIcon` on top.
- **Toasts:** `toast()` confirms that something was done, short and in the past tense ("Lina removed", "Saved"). They
  close by themselves. Use the error tone only for failures that need no decision.
- **Writes:** update the screen right away and send the write with `queued(…)`, which works offline and shows an
  error sheet if it fails. Await a write only when the server decides the outcome (following with a password, claiming
  a username).
- **Empty and first-time states:** say what's there and what to do next, in one sentence.

## Writing
- **Every text is in `src/i18n.ts`, in English and German.** No text in components.
- **Gender-neutral:** no "he/she/er/sie" for users or followers. Use "they" in English; in German use "die Person" or
  rephrase.
- **Short and concrete:** say what happens and what the person can do about it. Sentence case, no exclamation marks
  except in Nyxi's lines. Emoji only in Nyxi's lines, notifications and celebrations.
- **Privacy wording:** say plainly who can see something ("Followers can read shared notes", "They aren't notified").
  Don't reveal more than needed: a blocked account is told "You can't follow this account", never who blocked it or why.

## Accessibility
- Every pressable has `accessibilityRole` and an `accessibilityLabel`. Icon-only buttons always do; group a row's texts
  with a combined label (name, then the secondary line).
- Touch targets are at least 42 px (`IconButton`, `hitSlop` on small links).
- Respect reduced motion: Nyxi sits still, and animations stay short and decorative.
- Text stays readable in both themes: secondary text uses `C.textSoft`, never lighter than `C.muted` for content.

## Layout
- Phone first: 20 px padding around the content, cards full width, one column, at most 560 px wide (centred on larger screens).
- Content scrolls in one column. Avoid nested scrolling and horizontal scrolling.
- Lists of people or items are cards, not dense table rows.

## Testing a new screen
- A Playwright test against the dev server (`npx expo start --web`) with throwaway `@example.com` accounts covers the
  flow, in English and German, and in light and dark mode. Delete the test accounts afterwards: `@example.com` only,
  dry run first.
- Security rules for new data get cases in `scripts/test-rules.mjs` (allowed and denied).
