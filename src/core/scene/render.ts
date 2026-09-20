/**
 * Turning a scene into something you can put on the screen.
 *
 * A painter's algorithm: work out which faces are pointed at you, throw away
 * the rest, sort what is left back to front, and draw it. There is no z-buffer
 * and no WebGL — the output is a list of flat polygons in screen pixels, which
 * the view draws as SVG exactly the way the 2D plan is drawn.
 *
 * That choice is worth defending. A real 3D library would give better pictures,
 * and at some point one probably should. But the *hard* part of this view is
 * not the shading — it is knowing where the walls are once the doors have been
 * cut out of them, and where a wardrobe's carcass is once it has been resized
 * and rotated. All of that is arithmetic over the same document the plan reads,
 * and keeping the renderer as arithmetic too means the whole path from
 * "wardrobe at 30°" to "these pixels" is a pure function with a unit test on
 * it, in a project whose entire claim is that its numbers are right.
 *
 * ## Where a painter's algorithm gives up
 *
 * Sorting whole faces cannot resolve two that genuinely pass through each
 * other. Buildings are mercifully well behaved here — walls meet at their ends,
 * furniture stands on the floor rather than inside other furniture, and the one
 * case that does interpenetrate on purpose (a rug under a bed) differs enough
 * in depth to sort correctly. The sort key is each face's **farthest** corner
 * rather than its middle, which is what keeps a large floor behind the small
 * things standing on it.
 */

import { containsPoint, type Polygon } from '../geometry/polygon.ts';
import { dot3, normalize3, sub3, type Vec3 } from '../geometry/vec3.ts';
import { type Vec2 } from '../geometry/vec2.ts';
import { clipNear, project, viewBasis, type OrbitCamera, type ViewportSize } from './camera.ts';
import { prismFaces } from './prism.ts';
import { type Face3, type SceneMaterial, type SceneSolid, type SceneSource } from './types.ts';

/**
 * Where the light comes from.
 *
 * Two fixed directions rather than one, and the reason is specific to rooms. A
 * single light leaves every surface facing away from it on the ambient floor,
 * and in a cutaway view the walls you can see are the two facing the camera —
 * so from half the compass both of them come out identically flat and the
 * corner between them disappears. A weaker fill from behind and to the other
 * side gives all four cardinal directions a different brightness, which means
 * the corner reads from wherever you are standing.
 *
 * Fixed in the world rather than attached to the camera, because a light that
 * orbits with you lights everything the same however you turn it — and turning
 * the view to see the shape of something is most of what a 3D view is for.
 */
const KEY_LIGHT = normalize3({ x: 0.4, y: 0.5, z: 0.75 });
const FILL_LIGHT = normalize3({ x: -0.6, y: -0.45, z: 0.35 });
const FILL_STRENGTH = 0.35;

/** How dark an unlit surface goes. Interiors bounce a lot of light around. */
const AMBIENT = 0.5;

export interface ProjectedFace {
  /** Stable across frames, so React can keep the DOM node. */
  readonly id: string;
  /** Screen pixels, ready to draw. */
  readonly points: Polygon;
  readonly material: SceneMaterial;
  readonly source: SceneSource;
  /** 0 is fully shaded, 1 fully lit. */
  readonly shade: number;
  /** Distance to the farthest corner. The sort key, kept for tests. */
  readonly depth: number;
}

export interface RenderOptions {
  /**
   * Faces smaller than this many square pixels are dropped.
   *
   * A wardrobe seen edge-on contributes a sliver a fraction of a pixel wide
   * that nobody can see and the browser still has to rasterise. At a few
   * hundred solids that is most of the work for none of the picture.
   */
  readonly minimumArea?: number;
}

/**
 * Every visible face of a scene, farthest first.
 *
 * Draw them in the order returned and later ones cover earlier ones correctly.
 */
export function renderScene(
  solids: readonly SceneSolid[],
  camera: OrbitCamera,
  size: ViewportSize,
  options: RenderOptions = {},
): ProjectedFace[] {
  if (size.width <= 0 || size.height <= 0) return [];

  const minimumArea = options.minimumArea ?? 0.5;
  const basis = viewBasis(camera);
  const faces: ProjectedFace[] = [];

  for (const solid of solids) {
    const parts = prismFaces(solid);

    for (let index = 0; index < parts.length; index++) {
      const face = parts[index]!;
      if (!facesCamera(face, basis.eye)) continue;

      const clipped = clipNear(
        face.points.map((point) => {
          const offset = sub3(point, basis.eye);
          return {
            x: dot3(offset, basis.right),
            y: dot3(offset, basis.up),
            z: dot3(offset, basis.forward),
          };
        }),
      );
      if (clipped.length < 3) continue;

      const points = clipped.map((point) => project(point, size, camera.fieldOfView));
      if (screenArea(points) < minimumArea) continue;

      let depth = 0;
      for (const point of clipped) if (point.z > depth) depth = point.z;

      faces.push({
        id: `${solid.id}:${index}`,
        points,
        material: solid.material,
        source: solid.source,
        shade: shadeOf(face.normal),
        depth,
      });
    }
  }

  // Farthest first. Ties broken by id so the order is the same every frame and
  // two coplanar faces do not flicker against each other as the camera moves.
  faces.sort((a, b) => b.depth - a.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return faces;
}

/**
 * Is this face pointed at the eye?
 *
 * Measured against a point on the face rather than against the view direction,
 * which matters under perspective: a wall to one side of a wide view can be
 * turned away from the camera while still being roughly parallel to the
 * direction it is looking.
 */
function facesCamera(face: Face3, eye: Vec3): boolean {
  const anchor = face.points[0];
  if (!anchor) return false;
  return dot3(face.normal, sub3(eye, anchor)) > 0;
}

/** Lambert from both lights, over an ambient floor so nothing goes to black. */
function shadeOf(normal: Vec3): number {
  const lit =
    Math.max(0, dot3(normal, KEY_LIGHT)) + Math.max(0, dot3(normal, FILL_LIGHT)) * FILL_STRENGTH;

  return Math.min(1, AMBIENT + (1 - AMBIENT) * lit);
}

function screenArea(points: Polygon): number {
  let total = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    total += current.x * next.y - next.x * current.y;
  }
  return Math.abs(total) / 2;
}

/**
 * What is under the pointer.
 *
 * The faces are ordered back to front for drawing, so picking walks them
 * backwards: the last thing painted is the thing you can see, and that is the
 * thing a click should select.
 */
export function faceAt(faces: readonly ProjectedFace[], screen: Vec2): ProjectedFace | null {
  for (let index = faces.length - 1; index >= 0; index--) {
    const face = faces[index]!;
    if (containsPoint(face.points, screen)) return face;
  }
  return null;
}
