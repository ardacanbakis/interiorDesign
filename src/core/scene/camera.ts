/**
 * The orbit camera.
 *
 * Three numbers and a point: where you are looking, from how far, and from
 * which direction. That is the whole state, which is what makes the view
 * reproducible — it can be stored, restored, framed and tested without a
 * matrix stack anywhere.
 *
 * ## Which way round
 *
 * At yaw zero the camera sits on the **+y** side of its target, looking back
 * towards −y. In plan, +y is down the page, so this is standing at the bottom
 * of the drawing looking up it — and the consequence is that +x is still to
 * your right. The 3D view therefore opens reading the same way round as the
 * plan does, and turning it is something you choose rather than something you
 * have to undo before you can get your bearings.
 *
 * Yaw turns the eye exactly the way `rotate` in `vec2.ts` turns a vector —
 * clockwise as the plan is drawn. Pitch is the angle above the horizon: zero is
 * eye level, a right angle is straight down.
 */

import { type BoundingBox } from '../geometry/polygon.ts';
import { add3, cross3, dot3, normalize3, sub3, UP, vec3, type Vec3 } from '../geometry/vec3.ts';
import { type Mm } from '../units/length.ts';
import { type Vec2 } from '../geometry/vec2.ts';

export interface OrbitCamera {
  /** The point the camera swings around and looks at. */
  readonly target: Vec3;
  /** Eye to target, in millimetres. */
  readonly distance: Mm;
  /** Radians. Zero looks from +y towards −y. */
  readonly yaw: number;
  /** Radians above the horizon. */
  readonly pitch: number;
  /** Vertical field of view, in radians. */
  readonly fieldOfView: number;
}

/**
 * Pitch limits.
 *
 * Neither end is arbitrary. At exactly a right angle the view direction is
 * parallel to "up" and the camera's own right-hand axis is undefined, so the
 * picture would spin on its own; a degree short of it is indistinguishable and
 * well behaved. At the bottom end, level is as low as it goes: a camera below
 * the floor sees the underside of the slab and nothing else.
 *
 * Level itself is allowed, and is a view worth having — it is the one that
 * shows you a wall the way an elevation drawing would.
 */
export const MIN_PITCH = 0;
export const MAX_PITCH = (89 * Math.PI) / 180;

/** A room is a few metres across; these bracket that generously. */
export const MIN_DISTANCE: Mm = 600;
export const MAX_DISTANCE: Mm = 120_000;

/** Nothing closer than this to the eye is drawn. See `clipNear`. */
export const NEAR_PLANE: Mm = 60;

export const DEFAULT_FIELD_OF_VIEW = (50 * Math.PI) / 180;

export const DEFAULT_CAMERA: OrbitCamera = {
  target: { x: 0, y: 0, z: 1200 },
  distance: 9000,
  yaw: (-25 * Math.PI) / 180,
  // Steep enough to see over the near walls into the room, shallow enough that
  // the furniture still reads as furniture rather than as a floor plan.
  pitch: (32 * Math.PI) / 180,
  fieldOfView: DEFAULT_FIELD_OF_VIEW,
};

export function clampPitch(pitch: number): number {
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, pitch));
}

export function clampDistance(distance: Mm): Mm {
  return Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distance));
}

/** Where the eye actually is. */
export function cameraPosition(camera: OrbitCamera): Vec3 {
  const pitch = clampPitch(camera.pitch);
  const distance = clampDistance(camera.distance);

  const horizontal = Math.cos(pitch) * distance;

  return add3(camera.target, {
    x: -Math.sin(camera.yaw) * horizontal,
    y: Math.cos(camera.yaw) * horizontal,
    z: Math.sin(pitch) * distance,
  });
}

/** The plan direction from the target out towards the eye. */
export function viewDirectionInPlan(camera: OrbitCamera): Vec2 {
  return { x: -Math.sin(camera.yaw), y: Math.cos(camera.yaw) };
}

export interface ViewBasis {
  readonly eye: Vec3;
  /** Unit vector towards the target. */
  readonly forward: Vec3;
  /** Unit vector towards the right of the picture. */
  readonly right: Vec3;
  /** Unit vector towards the top of the picture. */
  readonly up: Vec3;
}

/**
 * The camera's own axes.
 *
 * `right` comes from the world's up and the view direction in that order, which
 * is the order that puts +x on the right of the picture at yaw zero rather than
 * mirroring the plan. There is a test for exactly that, because the wrong order
 * produces a scene that looks entirely plausible until you notice the door is
 * on the wrong side of the room.
 */
export function viewBasis(camera: OrbitCamera): ViewBasis {
  const eye = cameraPosition(camera);
  const forward = normalize3(sub3(camera.target, eye));
  const right = normalize3(cross3(UP, forward));
  const up = cross3(forward, right);

  return { eye, forward, right, up };
}

/**
 * A world point in the camera's frame: x to the right, y up, z into the
 * picture. Anything with a negative z is behind the eye.
 */
export function toCameraSpace(basis: ViewBasis, world: Vec3): Vec3 {
  const offset = sub3(world, basis.eye);
  return vec3(dot3(offset, basis.right), dot3(offset, basis.up), dot3(offset, basis.forward));
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Camera space to pixels.
 *
 * The scale comes off the **height**, so widening the window shows more of the
 * room rather than stretching what is already there. Screen y runs downwards
 * and camera y runs up, hence the subtraction.
 *
 * Points behind the near plane are not handled here; they are removed by
 * {@link clipNear} before anything is projected.
 */
export function project(point: Vec3, size: ViewportSize, fieldOfView: number): Vec2 {
  const focal = size.height / 2 / Math.tan(fieldOfView / 2);
  const depth = Math.max(point.z, NEAR_PLANE);

  return {
    x: size.width / 2 + (point.x * focal) / depth,
    y: size.height / 2 - (point.y * focal) / depth,
  };
}

/**
 * Clip a camera-space polygon against the near plane.
 *
 * A single-plane Sutherland–Hodgman, the same algorithm `overlap.ts` uses in
 * 2D. Without it, a vertex just behind the eye divides by a depth near zero and
 * flings the face across the screen as a huge coloured wedge — which is the
 * classic way a from-scratch renderer falls apart the moment someone zooms in
 * far enough to put their head through a wall.
 */
export function clipNear(polygon: readonly Vec3[], near: Mm = NEAR_PLANE): Vec3[] {
  if (polygon.length === 0) return [];

  const result: Vec3[] = [];

  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]!;
    const previous = polygon[(index - 1 + polygon.length) % polygon.length]!;

    const currentIn = current.z >= near;
    const previousIn = previous.z >= near;

    if (currentIn !== previousIn) {
      const t = (near - previous.z) / (current.z - previous.z);
      result.push({
        x: previous.x + (current.x - previous.x) * t,
        y: previous.y + (current.y - previous.y) * t,
        z: near,
      });
    }

    if (currentIn) result.push(current);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Moving it
// ---------------------------------------------------------------------------

/** Swing the camera around its target. */
export function orbit(camera: OrbitCamera, deltaYaw: number, deltaPitch: number): OrbitCamera {
  return {
    ...camera,
    yaw: camera.yaw + deltaYaw,
    pitch: clampPitch(camera.pitch + deltaPitch),
  };
}

/** Move the eye towards or away from the target. */
export function dolly(camera: OrbitCamera, factor: number): OrbitCamera {
  return { ...camera, distance: clampDistance(camera.distance * factor) };
}

/**
 * Slide the target across the ground.
 *
 * Panning moves in the camera's own frame flattened onto the floor, so dragging
 * right moves the view right whichever way the camera happens to be facing.
 */
export function pan(camera: OrbitCamera, right: Mm, forward: Mm): OrbitCamera {
  const basis = viewBasis(camera);

  const flatForward = normalize3(vec3(basis.forward.x, basis.forward.y, 0));
  const flatRight = normalize3(vec3(basis.right.x, basis.right.y, 0));

  return {
    ...camera,
    target: add3(camera.target, {
      x: flatRight.x * right + flatForward.x * forward,
      y: flatRight.y * right + flatForward.y * forward,
      z: 0,
    }),
  };
}

/**
 * Frame a plan so all of it is in view.
 *
 * The target sits at a third of the ceiling height rather than on the floor —
 * the interesting part of a room is the furniture, not the skirting — and the
 * distance comes from the smallest sphere about *that* point which still holds
 * every corner of the building. Taking the radius from the plan's diagonal
 * instead would be a sphere centred half a metre lower, which is exactly enough
 * to push the top of the far wall out of shot.
 *
 * Fitting a sphere rather than the corners themselves means the framing does
 * not change as the camera turns, so orbiting a framed plan never walks it off
 * the edge of the screen.
 */
export function frame(
  bounds: BoundingBox,
  ceilingHeight: Mm,
  size: ViewportSize,
  camera: OrbitCamera = DEFAULT_CAMERA,
): OrbitCamera {
  const height = Math.max(1, ceilingHeight);

  const target = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: height / 3,
  };

  let radius = 1;
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      for (const z of [0, height]) {
        radius = Math.max(radius, Math.hypot(x - target.x, y - target.y, z - target.z));
      }
    }
  }

  // A square window sees the same angle both ways; a wide one sees less
  // vertically per pixel across, so the vertical field is usually the binding
  // one — but a tall narrow window flips that, hence taking the smaller.
  const aspect = size.height > 0 ? size.width / size.height : 1;
  const horizontalFov = 2 * Math.atan(Math.tan(camera.fieldOfView / 2) * Math.max(0.2, aspect));
  const narrower = Math.min(camera.fieldOfView, horizontalFov);

  // A little headroom so the plan is not wedged against the edge of the frame.
  const distance = (radius / Math.sin(narrower / 2)) * 1.06;

  return { ...camera, target, distance: clampDistance(distance) };
}
