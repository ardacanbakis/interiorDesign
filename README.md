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
- **Clearance checking** — live warnings when a door swing is blocked, a wardrobe has no room
  to open, a sofa covers a radiator, or a window is blocked by something taller than its sill.
  Click a warning and the offending space lights up on the plan.

## Architecture in one paragraph

The source of truth is a **planar wall graph** (nodes and edges), not a list of rooms. Rooms are
_derived_ as the bounded faces of that graph via planar face extraction, which is what makes
shared walls work correctly. User data is attached to rooms by an **anchor point** rather than an
index, so splitting a room with a new wall keeps the name on the right half and deleting a wall
merges two rooms sensibly. All geometry, catalogue and rule logic lives in `src/core/` as pure
functions with no React imports — enforced by an ESLint rule — which is what makes the test suite
meaningful.

The checker is the same idea again. A rule is a pure function from a floor to a
list of issues, and most of the work is already done by the catalogue: every object
declares the space it needs to function, so one rule covers about twenty checks and
never has to change when furniture is added. Everything is height-aware, which is
what separates a checker people leave switched on from one they turn off — a rug
under a table, a shelf over a desk and a wall cupboard over a worktop all share floor
plan, and none of them is a problem.

Furniture follows the same principle: each kind is one `ItemDefinition` in `src/core/catalog/`
that knows how to draw itself in plan, build itself as boxes for 3D, and say what space it needs
to function — all as functions of its current dimensions. Adding a piece of furniture is an entry
in one file; the renderer never learns it exists. One table-driven test holds every definition,
at its defaults and at each of its standard sizes, to agreeing with its own stated width, depth
and height, so no object can quietly lie about how big it is.

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

### On Windows

Node 22 LTS or newer. Node 21 is end-of-life and ships an npm carrying a
[known optional-dependency bug](https://github.com/npm/cli/issues/4828) that leaves Vite's
native binary uninstalled; the symptom is `Cannot find native binding` on `npm run dev`. The
cure is to delete `node_modules` and `package-lock.json` and run `npm install` again.

### Deploying

Pushing to the default branch builds and publishes to GitHub Pages. Pages has to be switched
on for the repository once, by hand, under **Settings → Pages → Build and deployment → Source
→ GitHub Actions**. A workflow token is not permitted to enable it, so until that is done the
deploy job fails at `configure-pages` with a `Not Found`.

### Your plan stays on your machine

There is no server. A plan lives in the browser's own storage, which makes it private by
default and also means it does not follow you between devices. **Save to a file** is how a plan
travels — plain, indented JSON with its version at the top, so a plan outlives the app that
drew it.

### Stack

Vite · React 19 · TypeScript (strict, including `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`) · Zustand + Immer · Zod · Tailwind 4 · Vitest · Playwright.

The 2D plan is **plain SVG**, not a canvas library: it stays crisp at any zoom, gives pointer
hit-testing and accessible text for free, and serialises straight to PNG and PDF for export.

## Build plan

- [x] **M0** — Scaffold and toolchain
- [x] **M1** — Domain core: units, geometry, wall graph, face extraction, store, persistence
- [x] **M2** — 2D plan editor
- [x] **M3** — Start from a single room: create by typing its measurements
- [ ] **M3b** — Multi-floor and stairs _(parked — single-room work comes first)_
- [x] **M4** — Openings, and an object catalogue of 54 everyday things
- [x] **M5** — Clearance and ergonomics engine
- [ ] **M6** — 3D view
- [ ] **M7** — First-person walkthrough
- [ ] **M8** — Layout variants
- [ ] **M9** — Export and measuring checklists
- [ ] **M10** — Cloud sync and share links
- [x] **M11a** — Deployed demo on GitHub Pages _(case study still to write)_

## Licence

MIT
