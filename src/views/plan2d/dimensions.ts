/**
 * Working out which dimensions to show.
 *
 * Kept apart from the component that draws them: deciding what to measure is
 * plan logic, while `DimensionsLayer` only knows how to put a number on a line.
 */

import { boundingBox } from '../../core/geometry/polygon.ts';
import { distance, type Vec2 } from '../../core/geometry/vec2.ts';
import { getWall, nodePoint, type WallGraph } from '../../core/graph/wallGraph.ts';
import { type DerivedRoom } from '../../core/model/derive.ts';
import { type Mm } from '../../core/units/length.ts';
import { screenPixels, type Viewport } from './viewport.ts';

export interface Dimension {
  readonly id: string;
  /** The span being measured, in model coordinates. */
  readonly from: Vec2;
  readonly to: Vec2;
  /** How far off the span to draw the line, in model units. Sign picks a side. */
  readonly offset: Mm;
  readonly value: Mm;
  /** Present when the number can be typed into to move something. */
  readonly onChange?: (next: Mm) => void;
}

/**
 * Dimensions for a selected wall: its length, and how far it sits from the
 * bounding box of the plan on each side.
 *
 * Only the length is editable for now — moving a wall by typing a distance to
 * another wall needs the graph to know which of the two should move, which is
 * M3's problem. The length alone already covers "make this room 3.6 metres".
 */
export function wallDimensions(
  graph: WallGraph,
  wallId: string,
  viewport: Viewport,
  onLengthChange?: (next: Mm) => void,
): Dimension[] {
  const wall = getWall(graph, wallId);
  const a = nodePoint(graph, wall.a);
  const b = nodePoint(graph, wall.b);

  // Stand the dimension line clear of the wall it measures.
  const offset = wall.thickness / 2 + screenPixels(viewport, 26);

  return [
    {
      id: `wall-${wallId}-length`,
      from: a,
      to: b,
      offset,
      value: Math.round(distance(a, b)),
      ...(onLengthChange ? { onChange: onLengthChange } : {}),
    },
  ];
}

/**
 * Overall width and height of a room's usable floor.
 *
 * Read-only: the numbers a person wants when asking "will a 1.6m bed fit across
 * here?". Changing them means moving walls, which is what selecting the wall
 * and typing its length is for.
 */
export function roomDimensions(room: DerivedRoom, viewport: Viewport): Dimension[] {
  const box = boundingBox(room.geometry.outline);
  const gap = screenPixels(viewport, 22);

  return [
    {
      id: `room-${room.props.id}-width`,
      from: { x: box.minX, y: box.minY },
      to: { x: box.maxX, y: box.minY },
      offset: -gap,
      value: Math.round(box.maxX - box.minX),
    },
    {
      id: `room-${room.props.id}-height`,
      from: { x: box.minX, y: box.maxY },
      to: { x: box.minX, y: box.minY },
      offset: -gap,
      value: Math.round(box.maxY - box.minY),
    },
  ];
}
