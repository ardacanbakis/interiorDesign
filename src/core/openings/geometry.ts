/**
 * Where a door or window sits, and which way it opens.
 *
 * An opening is stored as a host wall, a distance along it, and a width — not
 * as coordinates. That is what makes it survive its wall being moved, stretched
 * or split: the door stays where it is *relative to the wall*, which is how
 * anyone would describe it ("the door is 600 from the corner").
 *
 * ## Hinge and side
 *
 * Between them, `hinge` and `side` give the four ways a door can be hung, and
 * the difference between them is the difference between a door that opens into
 * the room and one that hits the bed.
 *
 * - `hinge` is which *end of the opening* the hinge is at: the end nearer the
 *   wall's `a` node, or the end nearer its `b` node.
 * - `side` is which face of the wall the leaf swings towards, named relative to
 *   walking from `a` to `b`.
 *
 * Both are stored rather than inferred because the clearance check in M5 has to
 * know the swept area, and a swing arc drawn on the wrong side is worse than no
 * arc at all — it looks authoritative and is wrong.
 */

import { type Polygon } from '../geometry/polygon.ts';
import {
  add,
  cross,
  negate,
  normalize,
  perpendicular,
  rotate,
  scale,
  sub,
  type Vec2,
} from '../geometry/vec2.ts';
import { type Mm } from '../units/length.ts';
import { type GraphWall, nodePoint, type WallGraph } from '../graph/wallGraph.ts';
import { type Opening } from '../model/schema.ts';

export interface OpeningFrame {
  /** Centre of the opening, on the wall's centreline. */
  readonly centre: Vec2;
  /** Unit vector along the wall, from `a` towards `b`. */
  readonly along: Vec2;
  /** Unit vector across the wall, towards the right-hand side of `along`. */
  readonly across: Vec2;
  /** The end of the opening nearer the wall's `a` node. */
  readonly startPoint: Vec2;
  /** The end nearer its `b` node. */
  readonly endPoint: Vec2;
  /** The rectangle removed from the masonry. */
  readonly cutout: Polygon;
  readonly thickness: Mm;
}

/** Where an opening sits on its wall. */
export function openingFrame(
  graph: WallGraph,
  wall: GraphWall,
  opening: Pick<Opening, 'offset' | 'width'>,
): OpeningFrame {
  const a = nodePoint(graph, wall.a);
  const b = nodePoint(graph, wall.b);

  const along = normalize(sub(b, a));
  const across = perpendicular(along);
  const half = opening.width / 2;

  const centre = add(a, scale(along, opening.offset));
  const startPoint = add(centre, scale(along, -half));
  const endPoint = add(centre, scale(along, half));

  // Slightly deeper than the wall so the cut reliably clears both faces when
  // it is punched out of the masonry; a hairline of wall left behind at a
  // reveal is a rendering artefact people notice immediately.
  const reach = scale(across, wall.thickness / 2 + 1);

  return {
    centre,
    along,
    across,
    startPoint,
    endPoint,
    thickness: wall.thickness,
    cutout: [
      add(startPoint, negate(reach)),
      add(endPoint, negate(reach)),
      add(endPoint, reach),
      add(startPoint, reach),
    ],
  };
}

export interface DoorSwing {
  /** The point the leaf turns about. */
  readonly hinge: Vec2;
  /** Length of the leaf, which is the opening's width. */
  readonly radius: Mm;
  /** Where the free edge of the leaf is at the current `openAmount`. */
  readonly leafEnd: Vec2;
  /** The leaf's direction when shut, pointing away from the hinge. */
  readonly closedDirection: Vec2;
  /** The leaf's direction when fully open. */
  readonly openDirection: Vec2;
  /**
   * Which way the leaf turns: +1 is clockwise on screen, matching the
   * convention in `vec2.ts`.
   */
  readonly sweep: 1 | -1;
  /** The whole quarter-circle the leaf sweeps, whatever it is open to now. */
  readonly sector: Polygon;
}

/**
 * Where a door's leaf is, and the area it needs to get there.
 *
 * `sector` covers the **full** 90° sweep rather than the part swept so far.
 * A door that is currently shut still needs the space to open, so the clearance
 * check has to see the whole quarter-circle; a wardrobe placed in a shut door's
 * path is exactly the mistake this is meant to catch.
 */
export function doorSwing(
  graph: WallGraph,
  wall: GraphWall,
  opening: Pick<Opening, 'offset' | 'width' | 'hinge' | 'side' | 'openAmount'>,
  sectorSegments = 12,
): DoorSwing {
  const frame = openingFrame(graph, wall, opening);

  const hinge = opening.hinge === 'a' ? frame.startPoint : frame.endPoint;
  // Shut, the leaf lies in the opening, pointing away from its hinge.
  const closedDirection = opening.hinge === 'a' ? frame.along : negate(frame.along);
  const openDirection = opening.side === 'right' ? frame.across : negate(frame.across);

  // Which way round the leaf turns is not a choice — it is whichever rotation
  // takes the shut direction to the open one.
  const sweep: 1 | -1 = cross(closedDirection, openDirection) > 0 ? 1 : -1;
  const quarter = (Math.PI / 2) * sweep;

  const leafDirection = rotate(closedDirection, quarter * opening.openAmount);
  const leafEnd = add(hinge, scale(leafDirection, opening.width));

  const sector: Vec2[] = [hinge];
  for (let step = 0; step <= sectorSegments; step++) {
    const angle = quarter * (step / sectorSegments);
    sector.push(add(hinge, scale(rotate(closedDirection, angle), opening.width)));
  }

  return {
    hinge,
    radius: opening.width,
    leafEnd,
    closedDirection,
    openDirection,
    sweep,
    sector,
  };
}

/**
 * Keep an opening inside its wall.
 *
 * An opening is positioned by its centre, so the usable range for that centre
 * is half its width in from each end. A wall too short to hold the opening at
 * all collapses that range to a point, and the opening is centred — the
 * clearance engine will have something to say about it, which is better than
 * this silently producing a door hanging off the end of a wall.
 */
export function clampOffset(wallLength: Mm, width: Mm, offset: Mm): Mm {
  const half = width / 2;
  if (wallLength <= width) return Math.round(wallLength / 2);
  return Math.round(Math.min(wallLength - half, Math.max(half, offset)));
}

/** True when an opening of this width fits on a wall of this length at all. */
export function fitsOnWall(wallLength: Mm, width: Mm): boolean {
  return width > 0 && width <= wallLength;
}

/**
 * The widest opening a wall can take.
 *
 * Used to clamp the width field in the inspector, so the number offered is
 * always one that can actually be built.
 */
export function maxOpeningWidth(wallLength: Mm): Mm {
  return Math.max(0, Math.floor(wallLength));
}
