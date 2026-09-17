# interiorDesign

A whole-house interior layout planner. Draw rooms to exact measurements, furnish them with
everyday objects whose every dimension is editable, and find out what will actually fit.

> **Status:** in development. See [the build plan](#build-plan) for what has landed.

## What it does

- **Draw a whole house**, floor by floor, with rectilinear walls at exact measurements.
- **True shared walls** — two adjacent rooms share one wall of one thickness, and a door in it
  is one door, correct from both sides.
- **Rooms are discovered, not drawn** — enclose an area with walls and a room appears, with its
  area and perimeter computed from the inner wall faces.
- **Every object is parametric** — furniture is generated from its dimensions, so resizing a
  wardrobe is truthful in the plan, in 3D, and in its clearance requirements.
- **Clearance checking** — live warnings when a door swing is blocked, a walkway is too narrow,
  a wardrobe has no room to open, or a sofa covers a radiator.

## Architecture in one paragraph

The source of truth is a **planar wall graph** (nodes and edges), not a list of rooms. Rooms are
_derived_ as the bounded faces of that graph via planar face extraction, which is what makes
shared walls work correctly. User data is attached to rooms by an **anchor point** rather than an
index, so splitting a room with a new wall keeps the name on the right half and deleting a wall
merges two rooms sensibly. All geometry, catalogue and rule logic lives in `src/core/` as pure
functions with no React imports — enforced by an ESLint rule — which is what makes the test suite
meaningful.

## Getting started

```bash
npm install
npm run dev
```

| Command                 | What it does                                                 |
| ----------------------- | ------------------------------------------------------------ |
| `npm run dev`           | Dev server on http://localhost:5173                          |
| `npm run build`         | Typecheck and produce a production build                     |
| `npm run check`         | Typecheck, lint, and unit tests — run this before committing |
| `npm test`              | Unit tests (Vitest)                                          |
| `npm run test:coverage` | Unit tests with coverage thresholds                          |
| `npm run e2e`           | End-to-end tests (Playwright)                                |

### Stack

Vite · React 19 · TypeScript (strict, including `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`) · Zustand + Immer · Zod · Tailwind 4 · Vitest · Playwright.

The 2D plan is **plain SVG**, not a canvas library: it stays crisp at any zoom, gives pointer
hit-testing and accessible text for free, and serialises straight to PNG and PDF for export.

## Build plan

- [x] **M0** — Scaffold and toolchain
- [x] **M1** — Domain core: units, geometry, wall graph, face extraction, store, persistence
- [x] **M2** — 2D plan editor
- [ ] **M3** — Multi-floor and stairs
- [ ] **M4** — Openings and the object catalogue
- [ ] **M5** — Clearance and ergonomics engine
- [ ] **M6** — 3D view
- [ ] **M7** — First-person walkthrough
- [ ] **M8** — Layout variants
- [ ] **M9** — Export and measuring checklists
- [ ] **M10** — Cloud sync and share links
- [ ] **M11** — Deployment and case study

## Licence

MIT
