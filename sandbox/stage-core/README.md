# stage-core sandbox

A from-scratch prototype of the unified **Scene + Camera + Anchor** model that
replaces the scroll / zoom / viewport / spread coupling. The pure model lives in
`stage-core.js` (DOM-free, framework-free, serializable — the future Rust/Crux
core). The DOM appears only in `index.html` (the "projector" + input).

## Run

ES modules need http (not `file://`):

```bash
cd sandbox/stage-core
python3 -m http.server 8000
# open http://localhost:8000
```

## The model (three ideas)

- **Camera** `{ x, y, zoom }` — the world point at the viewport's top-left + scale.
  Scroll, zoom, pinch, pan, go-to-page are all pure camera ops.
- **Scene** — a layout strategy (`linearLayout` / `gridLayout`) turns pages into
  items (a page or a spread) with per-page boxes, plus a `query(rect)` spatial index.
- **Anchor** `{ pageIndex, fx, fy }` — _what you're looking at_, relative to a page.
  Capture before any change, restore after. One mechanism powers layout switches,
  spread toggles, viewport resizes, **and** session restore.

## What to try (and what it proves)

- **Zoom dropdown: Automatic / Fit Page / Fit Width / Custom.** Zoom is an _intent_
  resolved against the **current page**, so switching vertical ↔ horizontal ↔ grid
  keeps the same zoom (no more 277% → 5% jump). Manual wheel/pinch sets `Custom`.
- **Switch layout / toggle spread.** You stay on the same page — anchor preserved.
- **spread = odd/even.** Two _separate_ pages with a real gap, labelled individually.
- **⌘/ctrl + wheel / pinch.** Focal zoom, no bounce. Soft mid-gesture, then sharp on
  settle (whole-page raster ≤ ~2.6×, **tiles** beyond — sharpness is unbounded).
- **40000 pages, scroll deep.** Only ~visible pages render; no black at page 10k
  (origin rebasing keeps transform magnitudes small).
- **save & reload.** Persists the full view state; the page reloads and you land on
  the exact same page, zoom, layout and spread. (Normal reloads restore too.)

## Files

- `stage-core.js` — the pure model. `node` the snippet in the project chat to test it.
- `index.html` — projector, input, controls, persistence.
