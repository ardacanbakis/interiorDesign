/**
 * A floor, as solids.
 *
 * The part of the 3D view that is actually about buildings. Everything here is
 * a pure function of the same document the plan reads — there is no second
 * model of the room kept in step with the first, which is the usual way a 3D
 * view ends up disagreeing with the drawing it came from.
 *
 * Three things get built:
 *
 * - **Floors**, one slab per room, from its usable-floor polygon.
 * - **Walls**, split around their openings. A wall with a door in it is not a
 *   box with a hole: it is a pier, a lintel over the opening, and another pier
 *   — which is how it is actually built, and which keeps every solid in the
 *   scene a plain prism.
 * - **Furniture**, straight from the catalogue's `solid()`. Sixty objects
 *   already describe themselves as boxes; this transforms those boxes by the
 *   item's position, rotation and elevation and hands them over.
 */

import { boundingBox, type BoundingBox, type Polygon } from '../geometry/polygon.ts';
import { dot, sub, type Vec2 } from '../geometry/vec2.ts';
import { findDefinition, solidOf } from '../catalog/registry.ts';
import { toWorld } from '../catalog/placement.ts';
import { roomsOf } from '../model/derive.ts';
import { doorSwing, openingFrame } from '../openings/geometry.ts';
import { allNodes, allWalls, wallLength, type GraphWall } from '../graph/wallGraph.ts';
import { wallMidpoint, wallPolygon } from '../graph/wallShapes.ts';
import { type Floor, type Opening } from '../model/schema.ts';
import { type Mm } from '../units/length.ts';
import { viewDirectionInPlan, type OrbitCamera } from './camera.ts';
import { isDrawable, prism, slabBetween } from './prism.ts';
import { type SceneSolid, type SceneSource } from './types.ts';

/** A door leaf, in the flesh. 40mm is an ordinary internal door. */
const LEAF_THICKNESS: Mm = 40;

/** Double glazing in its frame, near enough. */
const GLAZING_THICKNESS: Mm = 28;

/** A window board, and how far it stands proud of the wall on each side. */
const SILL_THICKNESS: Mm = 30;
const SILL_OVERHANG: Mm = 25;

/**
 * How far the ground reaches past the building.
 *
 * Generous, and scaled to the plan, for a reason that is only obvious once you
 * have seen it go wrong: a ground plane that stops a couple of metres from the
 * walls puts its own cut edge in shot as soon as the camera drops towards
 * level, and a grey bar across the bottom of the picture reads as a rendering
 * fault rather than as the edge of the garden. Reaching well behind the camera
 * means the edge is clipped away and the ground simply runs to the horizon.
 */
const GROUND_MARGIN: Mm = 20_000;
const GROUND_SPANS = 5;
const GROUND_THICKNESS: Mm = 200;

export interface SceneOptions {
  /**
   * Put the building on a patch of ground.
   *
   * On by default. Without it the plan floats in an empty colour and there is
   * nothing to tell you which way is down until something casts a shadow —
   * which, with a renderer this size, nothing does.
   */
  readonly ground?: boolean;
}

/** Everything on a floor, ready to be rendered. */
export function buildScene(floor: Floor, options: SceneOptions = {}): SceneSolid[] {
  const solids: SceneSolid[] = [];

  if (options.ground !== false) {
    const ground = groundSolid(floor);
    if (ground) solids.push(ground);
  }

  solids.push(...floorSolids(floor));
  solids.push(...wallSolids(floor));
  solids.push(...openingSolids(floor));
  solids.push(...itemSolids(floor));

  return solids.filter(isDrawable);
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

/**
 * One slab per room, sitting under the walls rather than between them.
 *
 * The polygon is the room's *usable floor* — the one `roomGeometry.ts` works
 * out by insetting each edge by half its own wall — so the visible floor in 3D
 * is exactly the area the status bar is quoting. Anything else would be a
 * second opinion about the size of the room.
 */
export function floorSolids(floor: Floor): SceneSolid[] {
  return roomsOf(floor).map((room) => ({
    ...prism(room.geometry.outline, -floor.slabThickness, 0),
    id: `floor:${room.props.id}`,
    material: 'floor' as const,
    source: { kind: 'room', id: room.props.id } satisfies SceneSource,
  }));
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

export function wallSolids(floor: Floor): SceneSolid[] {
  return allWalls(floor.graph).flatMap((wall) => oneWall(floor, wall));
}

interface Hole {
  readonly opening: Opening;
  readonly start: Mm;
  readonly end: Mm;
}

/**
 * One wall, in as many pieces as its openings leave it in.
 *
 * Walked from one end to the other: solid up to the next opening, a lintel over
 * it, an apron under it if it has a sill, then on. Openings that overlap each
 * other — which the document allows and the clearance checker complains about —
 * simply merge into one gap here rather than producing masonry inside masonry.
 */
function oneWall(floor: Floor, wall: GraphWall): SceneSolid[] {
  const graph = floor.graph;
  const length = wallLength(graph, wall);
  const ceiling = floor.ceilingHeight;
  if (length <= 0 || ceiling <= 0) return [];

  const holes: Hole[] = floor.openings
    .filter((opening) => opening.wallId === wall.id)
    .map((opening) => ({
      opening,
      start: clamp(opening.offset - opening.width / 2, 0, length),
      end: clamp(opening.offset + opening.width / 2, 0, length),
    }))
    .filter((hole) => hole.end > hole.start)
    .sort((a, b) => a.start - b.start);

  if (holes.length === 0) {
    return [
      {
        ...prism(wallPolygon(graph, wall), 0, ceiling),
        id: `wall:${wall.id}`,
        material: 'wall',
        source: { kind: 'wall', id: wall.id },
        hostWallId: wall.id,
      },
    ];
  }

  const pieces: SceneSolid[] = [];
  let part = 0;

  const push = (from: Mm, to: Mm, bottom: Mm, top: Mm) => {
    if (to - from < 1 || top - bottom < 1) return;
    pieces.push({
      ...prism(spanBase(floor, wall, from, to), bottom, top),
      id: `wall:${wall.id}:${part++}`,
      material: 'wall',
      source: { kind: 'wall', id: wall.id },
      hostWallId: wall.id,
    });
  };

  let cursor = 0;
  for (const hole of holes) {
    const start = Math.max(cursor, hole.start);
    const end = Math.max(start, hole.end);

    push(cursor, start, 0, ceiling);

    const head = Math.min(hole.opening.sillHeight + hole.opening.height, ceiling);
    push(start, end, head, ceiling);
    if (hole.opening.sillHeight > 0) {
      push(start, end, 0, Math.min(hole.opening.sillHeight, ceiling));
    }

    cursor = Math.max(cursor, end);
  }

  push(cursor, length, 0, ceiling);

  return pieces;
}

/** The rectangle a stretch of one wall occupies, measured from its `a` node. */
function spanBase(floor: Floor, wall: GraphWall, from: Mm, to: Mm): Polygon {
  const nodeA = floor.graph.nodes[wall.a];
  const nodeB = floor.graph.nodes[wall.b];
  if (!nodeA || !nodeB) return [];

  const length = wallLength(floor.graph, wall);
  if (length <= 0) return [];

  const direction = { x: (nodeB.x - nodeA.x) / length, y: (nodeB.y - nodeA.y) / length };
  const at = (distance: Mm): Vec2 => ({
    x: nodeA.x + direction.x * distance,
    y: nodeA.y + direction.y * distance,
  });

  return slabBetween(at(from), at(to), wall.thickness);
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

/**
 * What fills the holes: a leaf for every door, glass and a board for every
 * window. A doorway — an opening with no door in it — is just the hole, which
 * is the whole point of it.
 */
export function openingSolids(floor: Floor): SceneSolid[] {
  const solids: SceneSolid[] = [];

  for (const opening of floor.openings) {
    const wall = floor.graph.walls[opening.wallId];
    if (!wall) continue;

    const source: SceneSource = { kind: 'opening', id: opening.id };

    if (opening.kind === 'door') {
      // Where the leaf is *now*, at whatever the opening slider says — so
      // "see how the door opens" means watching it move rather than reading
      // an arc on a drawing.
      const swing = doorSwing(floor.graph, wall, opening);
      solids.push({
        ...prism(slabBetween(swing.hinge, swing.leafEnd, LEAF_THICKNESS), 0, opening.height),
        id: `opening:${opening.id}:leaf`,
        material: 'door-leaf',
        source,
        hostWallId: wall.id,
      });
      continue;
    }

    if (opening.kind !== 'window') continue;

    const frame = openingFrame(floor.graph, wall, opening);
    const top = opening.sillHeight + opening.height;

    solids.push({
      ...prism(
        slabBetween(frame.startPoint, frame.endPoint, GLAZING_THICKNESS),
        opening.sillHeight,
        top,
      ),
      id: `opening:${opening.id}:glass`,
      material: 'glass',
      source,
      hostWallId: wall.id,
    });

    solids.push({
      ...prism(
        slabBetween(frame.startPoint, frame.endPoint, wall.thickness + SILL_OVERHANG * 2),
        Math.max(0, opening.sillHeight - SILL_THICKNESS),
        opening.sillHeight,
      ),
      id: `opening:${opening.id}:sill`,
      material: 'sill',
      source,
      hostWallId: wall.id,
    });
  }

  return solids;
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/**
 * The catalogue, in three dimensions.
 *
 * Every definition already returns a list of boxes in its own coordinates —
 * origin at the centre of the footprint, +y towards the front, z measured from
 * the underside of the object. All this does is put them where the item is:
 * rotate by its rotation, translate by its position, and lift by its elevation,
 * using the same `toWorld` the plan symbol and the clearance zones go through.
 * A wall-hung basin at 850 and a rug at 0 need no special handling because
 * elevation is the only thing that distinguishes them.
 */
export function itemSolids(floor: Floor): SceneSolid[] {
  const solids: SceneSolid[] = [];

  for (const item of floor.items) {
    // A kind this build has never heard of is a document from a newer version.
    // The plan leaves it out rather than falling over; so does this.
    if (!findDefinition(item.kind)) continue;

    const parts = solidOf(item);
    const source: SceneSource = { kind: 'item', id: item.id };

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]!;
      const halfX = part.size.x / 2;
      const halfY = part.size.y / 2;

      const base = [
        { x: part.centre.x - halfX, y: part.centre.y - halfY },
        { x: part.centre.x + halfX, y: part.centre.y - halfY },
        { x: part.centre.x + halfX, y: part.centre.y + halfY },
        { x: part.centre.x - halfX, y: part.centre.y + halfY },
      ].map((corner) => toWorld(item, corner));

      const bottom = item.elevation + part.centre.z - part.size.z / 2;

      solids.push({
        ...prism(base, bottom, bottom + part.size.z),
        id: `item:${item.id}:${index}`,
        material: part.material,
        source,
      });
    }
  }

  return solids;
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

function groundSolid(floor: Floor): SceneSolid | null {
  const bounds = planBounds(floor);
  if (!bounds) return null;

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const margin = Math.max(GROUND_MARGIN, span * GROUND_SPANS);

  const base: Polygon = [
    { x: bounds.minX - margin, y: bounds.minY - margin },
    { x: bounds.maxX + margin, y: bounds.minY - margin },
    { x: bounds.maxX + margin, y: bounds.maxY + margin },
    { x: bounds.minX - margin, y: bounds.maxY + margin },
  ];

  const top = -floor.slabThickness;

  return {
    ...prism(base, top - GROUND_THICKNESS, top),
    id: 'ground',
    material: 'ground',
    source: { kind: 'none' },
  };
}

/** The extent of the built plan, or null when nothing has been drawn. */
export function planBounds(floor: Floor): BoundingBox | null {
  const points = allNodes(floor.graph).map((node) => ({ x: node.x, y: node.y }));
  return points.length === 0 ? null : boundingBox(points);
}

// ---------------------------------------------------------------------------
// Cutaway
// ---------------------------------------------------------------------------

/**
 * Above this pitch, nothing is hidden.
 *
 * Looking almost straight down you are already over the tops of the walls and
 * can see in; taking them away as well would leave a floor plan with furniture
 * on it, which is the view next door.
 */
export const CUTAWAY_MAX_PITCH = (72 * Math.PI) / 180;

/**
 * The walls standing between you and what you are looking at.
 *
 * Without this, a room drawn honestly is a closed box and the 3D view shows you
 * the outside of it. Every dollhouse view solves this somehow; the rule here is
 * the simplest one that is also stable as the camera turns — a wall is in the
 * way if its middle is on the camera's side of the point the camera is looking
 * at. Walls running edge-on to the view sit exactly on the boundary and are
 * kept, which is what stops the side walls of a room flickering in and out as
 * you orbit past them.
 */
export function hiddenWallIds(floor: Floor, camera: OrbitCamera): Set<string> {
  const hidden = new Set<string>();
  if (camera.pitch >= CUTAWAY_MAX_PITCH) return hidden;

  const towardsCamera = viewDirectionInPlan(camera);
  const focus: Vec2 = { x: camera.target.x, y: camera.target.y };

  for (const wall of allWalls(floor.graph)) {
    const middle = wallMidpoint(floor.graph, wall);
    if (dot(sub(middle, focus), towardsCamera) > 0) hidden.add(wall.id);
  }

  return hidden;
}

/**
 * Take the named walls out, and everything hung on them with them.
 *
 * A door left floating where its wall used to be is a worse picture than no
 * cutaway at all, which is what `hostWallId` exists for.
 */
export function withoutWalls(
  solids: readonly SceneSolid[],
  hidden: ReadonlySet<string>,
): SceneSolid[] {
  if (hidden.size === 0) return [...solids];
  return solids.filter((solid) => solid.hostWallId === undefined || !hidden.has(solid.hostWallId));
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
