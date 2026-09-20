/**
 * The painter.
 *
 * Three things have to be right for a scene built from boxes to look like a
 * room: only the faces pointed at you are drawn, they are drawn far to near,
 * and nothing behind the eye is drawn at all. Everything else is colour.
 */

import { describe, expect, it } from 'vitest';

import { boundingBox } from '../geometry/polygon.ts';
import { vec3 } from '../geometry/vec3.ts';
import { DEFAULT_CAMERA, type OrbitCamera } from './camera.ts';
import { prism } from './prism.ts';
import { faceAt, renderScene } from './render.ts';
import { type SceneSolid } from './types.ts';

const SIZE = { width: 800, height: 600 };

function camera(overrides: Partial<OrbitCamera> = {}): OrbitCamera {
  return {
    ...DEFAULT_CAMERA,
    target: vec3(0, 0, 500),
    distance: 6000,
    yaw: 0,
    pitch: (30 * Math.PI) / 180,
    ...overrides,
  };
}

function box(id: string, centreX: number, centreY: number, size = 1000): SceneSolid {
  const half = size / 2;
  return {
    ...prism(
      [
        { x: centreX - half, y: centreY - half },
        { x: centreX + half, y: centreY - half },
        { x: centreX + half, y: centreY + half },
        { x: centreX - half, y: centreY + half },
      ],
      0,
      size,
    ),
    id,
    material: 'carcass',
    source: { kind: 'item', id },
  };
}

describe('drawing only what you can see', () => {
  it('shows three faces of a cube seen from a corner and above', () => {
    // A closed box has six; from any general direction exactly three are
    // pointed at you. Drawing the other three would paint the inside of the
    // box over the outside of it.
    const faces = renderScene([box('a', 0, 0)], camera({ yaw: -Math.PI / 4 }), SIZE);
    expect(faces).toHaveLength(3);
  });

  it('never shows the underside of something standing on the floor', () => {
    const faces = renderScene([box('a', 0, 0)], camera(), SIZE);
    // The top is visible from above; the bottom never is.
    expect(faces.some((face) => face.id === 'a:0')).toBe(true);
    expect(faces.some((face) => face.id === 'a:1')).toBe(false);
  });

  it('shows the top and one side when looking square on', () => {
    const faces = renderScene([box('a', 0, 0)], camera({ yaw: 0 }), SIZE);
    expect(faces).toHaveLength(2);
  });

  it('draws nothing into a window with no size', () => {
    expect(renderScene([box('a', 0, 0)], camera(), { width: 0, height: 0 })).toEqual([]);
  });
});

describe('drawing in the right order', () => {
  it('paints the far box before the near one', () => {
    // Which is the whole of the painter's algorithm: get this backwards and
    // everything at the back of the room is in front of everything else.
    const faces = renderScene([box('near', 0, 2000), box('far', 0, -2000)], camera(), SIZE);

    const firstNear = faces.findIndex((face) => face.id.startsWith('near'));
    const lastFar = faces.map((face) => face.id.startsWith('far')).lastIndexOf(true);

    expect(lastFar).toBeLessThan(firstNear);
  });

  it('paints a large floor behind the small things standing on it', () => {
    // The reason the sort key is each face's farthest corner rather than its
    // middle: a floor's middle is closer than the back of the room, but the
    // floor still belongs behind everything on it.
    const floor: SceneSolid = {
      ...prism(
        [
          { x: -4000, y: -4000 },
          { x: 4000, y: -4000 },
          { x: 4000, y: 4000 },
          { x: -4000, y: 4000 },
        ],
        -150,
        0,
      ),
      id: 'floor',
      material: 'floor',
      source: { kind: 'room', id: 'r1' },
    };

    const faces = renderScene([floor, box('wardrobe', 0, -3000)], camera(), SIZE);

    // The slab's top face, specifically. Its near edge really is in front of
    // the wardrobe and is drawn later, which is correct.
    const floorTop = faces.findIndex((face) => face.id === 'floor:0');
    const firstWardrobe = faces.findIndex((face) => face.id.startsWith('wardrobe'));

    expect(floorTop).toBeGreaterThanOrEqual(0);
    expect(floorTop).toBeLessThan(firstWardrobe);
  });

  it('orders the same way every frame, so nothing flickers', () => {
    const scene = [box('a', 0, 0), box('b', 1200, 0), box('c', -1200, 0)];
    const once = renderScene(scene, camera(), SIZE).map((face) => face.id);
    const again = renderScene([...scene].reverse(), camera(), SIZE).map((face) => face.id);

    expect(again).toEqual(once);
  });
});

describe('the near plane', () => {
  it('drops what is behind the eye rather than flinging it across the screen', () => {
    // The classic way a hand-rolled renderer falls apart: a vertex just behind
    // the camera divides by a depth near zero and paints a huge wedge.
    const behind = renderScene([box('a', 0, 0)], camera({ distance: 600, pitch: 0 }), SIZE);

    for (const face of behind) {
      const bounds = boundingBox(face.points);
      expect(Number.isFinite(bounds.minX)).toBe(true);
      expect(bounds.maxX - bounds.minX).toBeLessThan(100_000);
    }
  });

  it('still draws the part of a face that is in front', () => {
    // A floor stretching out past the camera in both directions: half of it is
    // behind the eye and the other half is the picture. Dropping the whole
    // face because one corner is behind would leave a hole in the ground.
    const ground: SceneSolid = {
      ...prism(
        [
          { x: -8000, y: -8000 },
          { x: 8000, y: -8000 },
          { x: 8000, y: 8000 },
          { x: -8000, y: 8000 },
        ],
        -150,
        0,
      ),
      id: 'ground',
      material: 'ground',
      source: { kind: 'none' },
    };

    const faces = renderScene([ground], camera({ pitch: 0, distance: 3000 }), SIZE);
    const top = faces.find((face) => face.id === 'ground:0');

    expect(top).toBeDefined();
    for (const point of top!.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});

describe('shading', () => {
  it('lights the top of a box more brightly than its sides', () => {
    const faces = renderScene([box('a', 0, 0)], camera({ yaw: -Math.PI / 4 }), SIZE);
    const top = faces.find((face) => face.id === 'a:0')!;

    for (const side of faces.filter((face) => face.id !== 'a:0')) {
      expect(top.shade).toBeGreaterThan(side.shade);
    }
  });

  it('never goes fully dark, because interiors bounce light around', () => {
    const faces = renderScene([box('a', 0, 0)], camera({ yaw: 2.1 }), SIZE);
    for (const face of faces) {
      expect(face.shade).toBeGreaterThan(0.3);
      expect(face.shade).toBeLessThanOrEqual(1);
    }
  });

  it('shades the two vertical sides of a box differently', () => {
    // A fixed light is what makes turning the view change the picture. A light
    // that follows the camera lights every wall identically and flattens it.
    const faces = renderScene([box('a', 0, 0)], camera({ yaw: -Math.PI / 4 }), SIZE);
    const sides = faces.filter((face) => face.id !== 'a:0').map((face) => face.shade);

    expect(new Set(sides).size).toBe(2);
  });
});

describe('picking', () => {
  it('finds the solid under the pointer', () => {
    const faces = renderScene([box('a', 0, 0)], camera(), SIZE);
    const hit = faceAt(faces, { x: SIZE.width / 2, y: SIZE.height / 2 });

    expect(hit?.source).toEqual({ kind: 'item', id: 'a' });
  });

  it('finds nothing where there is nothing', () => {
    const faces = renderScene([box('a', 0, 0)], camera(), SIZE);
    expect(faceAt(faces, { x: 5, y: 5 })).toBeNull();
  });

  it('picks what is in front when two things overlap on screen', () => {
    // Level and square on, so the near box stands directly in front of the far
    // one. Faces are ordered back to front for drawing, so picking walks them
    // backwards — the last thing painted is the thing you can see.
    const level = camera({ pitch: 0 });
    const faces = renderScene([box('near', 0, 1500), box('far', 0, -1500)], level, SIZE);
    const hit = faceAt(faces, { x: SIZE.width / 2, y: SIZE.height / 2 });

    expect(hit?.source).toEqual({ kind: 'item', id: 'near' });
  });
});

describe('dropping what is too small to see', () => {
  /** A pane of glass 1mm thick and 4m across, seen exactly edge-on. */
  const pane: SceneSolid = {
    ...prism(
      [
        { x: -2000, y: 0 },
        { x: 2000, y: 0 },
        { x: 2000, y: 1 },
        { x: -2000, y: 1 },
      ],
      0,
      2000,
    ),
    id: 'pane',
    material: 'glass',
    source: { kind: 'none' },
  };

  // From the side and a long way off, its only visible face is a hundredth of
  // a pixel wide: work for the browser, and nothing at all to look at.
  const edgeOn = camera({ pitch: 0, yaw: -Math.PI / 2, distance: 60_000 });

  it('leaves out a face thinner than a pixel', () => {
    expect(renderScene([pane], edgeOn, SIZE)).toEqual([]);
  });

  it('keeps it when asked to keep everything', () => {
    expect(renderScene([pane], edgeOn, SIZE, { minimumArea: 0 })).toHaveLength(1);
  });
});
