import { describe, expect, it } from 'vitest';

import { nearlyEquals3, vec3 } from '../geometry/vec3.ts';
import {
  cameraPosition,
  clampDistance,
  clampPitch,
  clipNear,
  DEFAULT_CAMERA,
  dolly,
  frame,
  MAX_PITCH,
  MIN_PITCH,
  NEAR_PLANE,
  orbit,
  pan,
  project,
  toCameraSpace,
  viewBasis,
  viewDirectionInPlan,
  type OrbitCamera,
} from './camera.ts';

const SIZE = { width: 800, height: 600 };

function cameraAt(overrides: Partial<OrbitCamera> = {}): OrbitCamera {
  return { ...DEFAULT_CAMERA, target: vec3(0, 0, 0), yaw: 0, pitch: 0, ...overrides };
}

describe('the camera — where it is', () => {
  it('stands on the +y side of its target at yaw zero', () => {
    // Which in plan is the bottom of the page, looking up it.
    const eye = cameraPosition(cameraAt({ distance: 5000 }));
    expect(nearlyEquals3(eye, vec3(0, 5000, 0), 1e-6)).toBe(true);
  });

  it('turns the same way a positive rotation turns a plan vector', () => {
    const eye = cameraPosition(cameraAt({ distance: 5000, yaw: Math.PI / 2 }));
    expect(nearlyEquals3(eye, vec3(-5000, 0, 0), 1e-6)).toBe(true);
  });

  it('climbs as pitch increases, keeping the distance', () => {
    const eye = cameraPosition(cameraAt({ distance: 5000, pitch: Math.PI / 6 }));
    expect(eye.z).toBeCloseTo(2500, 6);
    expect(Math.hypot(eye.x - 0, eye.y - 0, eye.z - 0)).toBeCloseTo(5000, 6);
  });

  it('reports the plan direction it is looking from', () => {
    const direction = viewDirectionInPlan(cameraAt({ yaw: 0 }));
    expect(direction.x).toBeCloseTo(0, 9);
    expect(direction.y).toBeCloseTo(1, 9);
  });
});

describe('the camera — which way is right', () => {
  it('puts +x on the right of the picture at yaw zero', () => {
    // The whole reason the default yaw looks from +y. Get this backwards and
    // the 3D view is a mirror image of the plan: everything is where you
    // expect until you notice the door has moved to the other side.
    const basis = viewBasis(cameraAt({ distance: 5000 }));
    expect(nearlyEquals3(basis.right, vec3(1, 0, 0), 1e-9)).toBe(true);
  });

  it('points "up" at the sky while looking level', () => {
    const basis = viewBasis(cameraAt({ distance: 5000 }));
    expect(nearlyEquals3(basis.up, vec3(0, 0, 1), 1e-9)).toBe(true);
  });

  it('keeps right horizontal however steeply it looks down', () => {
    const basis = viewBasis(cameraAt({ distance: 5000, pitch: MAX_PITCH }));
    expect(basis.right.z).toBeCloseTo(0, 9);
    expect(Math.hypot(basis.right.x, basis.right.y)).toBeCloseTo(1, 9);
  });

  it('measures depth forwards from the eye', () => {
    const camera = cameraAt({ distance: 5000 });
    const basis = viewBasis(camera);

    expect(toCameraSpace(basis, camera.target).z).toBeCloseTo(5000, 6);
    // A point a metre to the right of the target is a metre to the right in
    // the camera's frame too, and no further away.
    const beside = toCameraSpace(basis, vec3(1000, 0, 0));
    expect(beside.x).toBeCloseTo(1000, 6);
    expect(beside.z).toBeCloseTo(5000, 6);
  });
});

describe('the camera — limits', () => {
  it('never looks exactly straight down', () => {
    // At exactly a right angle the horizontal axis is undefined and the
    // picture would spin on its own.
    expect(clampPitch(Math.PI / 2)).toBe(MAX_PITCH);
    expect(clampPitch(-Math.PI)).toBe(MIN_PITCH);
    expect(orbit(cameraAt(), 0, 10).pitch).toBe(MAX_PITCH);
    expect(orbit(cameraAt(), 0, -10).pitch).toBe(MIN_PITCH);
  });

  it('lets yaw run round and round', () => {
    // Nothing breaks at 360°, and clamping it would make the view stop dead
    // halfway through a drag.
    expect(orbit(cameraAt({ yaw: 6 }), 1, 0).yaw).toBe(7);
  });

  it('keeps the distance inside something a room can use', () => {
    expect(clampDistance(1)).toBeGreaterThan(1);
    expect(dolly(cameraAt({ distance: 5000 }), 0.5).distance).toBe(2500);
    expect(dolly(cameraAt({ distance: 5000 }), 0.000_01).distance).toBe(clampDistance(0));
  });
});

describe('the camera — projection', () => {
  it('puts the target in the middle of the picture', () => {
    const camera = cameraAt({ distance: 5000, pitch: Math.PI / 6 });
    const basis = viewBasis(camera);

    const screen = project(toCameraSpace(basis, camera.target), SIZE, camera.fieldOfView);
    expect(screen.x).toBeCloseTo(SIZE.width / 2, 6);
    expect(screen.y).toBeCloseTo(SIZE.height / 2, 6);
  });

  it('puts something up in the world higher up the screen', () => {
    const camera = cameraAt({ distance: 5000 });
    const basis = viewBasis(camera);

    const low = project(toCameraSpace(basis, vec3(0, 0, 0)), SIZE, camera.fieldOfView);
    const high = project(toCameraSpace(basis, vec3(0, 0, 2000)), SIZE, camera.fieldOfView);
    expect(high.y).toBeLessThan(low.y);
  });

  it('puts something to the right of the target to the right on screen', () => {
    const camera = cameraAt({ distance: 5000 });
    const basis = viewBasis(camera);

    const right = project(toCameraSpace(basis, vec3(1000, 0, 0)), SIZE, camera.fieldOfView);
    expect(right.x).toBeGreaterThan(SIZE.width / 2);
  });

  it('draws nearer things bigger', () => {
    const camera = cameraAt({ distance: 5000 });
    const basis = viewBasis(camera);
    const fov = camera.fieldOfView;

    // The camera stands at +y, so a smaller y is further away.
    const near = project(toCameraSpace(basis, vec3(500, 1000, 0)), SIZE, fov).x;
    const far = project(toCameraSpace(basis, vec3(500, -1000, 0)), SIZE, fov).x;

    expect(near - SIZE.width / 2).toBeGreaterThan(far - SIZE.width / 2);
  });

  it('scales off the height, so a wider window shows more rather than stretching', () => {
    const camera = cameraAt({ distance: 5000 });
    const basis = viewBasis(camera);
    const point = toCameraSpace(basis, vec3(1000, 0, 0));

    const narrow = project(point, { width: 400, height: 600 }, camera.fieldOfView);
    const wide = project(point, { width: 1200, height: 600 }, camera.fieldOfView);

    expect(narrow.x - 200).toBeCloseTo(wide.x - 600, 6);
  });
});

describe('the camera — the near plane', () => {
  it('leaves a polygon wholly in front of it alone', () => {
    const polygon = [vec3(0, 0, 1000), vec3(100, 0, 1000), vec3(100, 100, 1000)];
    expect(clipNear(polygon)).toEqual(polygon);
  });

  it('throws away a polygon wholly behind it', () => {
    expect(clipNear([vec3(0, 0, -10), vec3(100, 0, -20), vec3(100, 100, -30)])).toEqual([]);
  });

  it('cuts one that straddles it, leaving the cut exactly on the plane', () => {
    // Without this a vertex just behind the eye divides by a depth near zero
    // and flings the face across the screen as a huge coloured wedge.
    const clipped = clipNear([vec3(0, 0, 1000), vec3(0, 0, -1000), vec3(1000, 0, -1000)]);

    expect(clipped.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...clipped.map((point) => point.z))).toBeCloseTo(NEAR_PLANE, 9);
  });

  it('keeps the part in front where it was', () => {
    const clipped = clipNear([vec3(0, 0, 500), vec3(200, 0, 500), vec3(200, 0, -500)]);
    expect(clipped).toContainEqual(vec3(0, 0, 500));
    expect(clipped).toContainEqual(vec3(200, 0, 500));
  });
});

describe('the camera — framing a plan', () => {
  const bounds = { minX: 0, minY: 0, maxX: 4000, maxY: 6000 };

  it('looks at the middle of the plan, a little above the floor', () => {
    const framed = frame(bounds, 2700, SIZE);
    expect(framed.target.x).toBe(2000);
    expect(framed.target.y).toBe(3000);
    expect(framed.target.z).toBeCloseTo(900, 6);
  });

  it('stands far enough back to see all of it', () => {
    const framed = frame(bounds, 2700, SIZE);
    const basis = viewBasis(framed);

    const corners = [
      vec3(bounds.minX, bounds.minY, 0),
      vec3(bounds.maxX, bounds.minY, 0),
      vec3(bounds.maxX, bounds.maxY, 0),
      vec3(bounds.minX, bounds.maxY, 0),
      vec3(bounds.minX, bounds.minY, 2700),
      vec3(bounds.maxX, bounds.maxY, 2700),
    ];

    for (const corner of corners) {
      const screen = project(toCameraSpace(basis, corner), SIZE, framed.fieldOfView);
      expect(screen.x).toBeGreaterThanOrEqual(0);
      expect(screen.x).toBeLessThanOrEqual(SIZE.width);
      expect(screen.y).toBeGreaterThanOrEqual(0);
      expect(screen.y).toBeLessThanOrEqual(SIZE.height);
    }
  });

  it('backs off further for a bigger plan', () => {
    const small = frame({ minX: 0, minY: 0, maxX: 3000, maxY: 3000 }, 2700, SIZE);
    const large = frame({ minX: 0, minY: 0, maxX: 30_000, maxY: 30_000 }, 2700, SIZE);
    expect(large.distance).toBeGreaterThan(small.distance);
  });

  it('keeps the angle it was given, so framing does not throw the view away', () => {
    const turned = { ...DEFAULT_CAMERA, yaw: 1.2, pitch: 0.5 };
    const framed = frame(bounds, 2700, SIZE, turned);
    expect(framed.yaw).toBe(1.2);
    expect(framed.pitch).toBe(0.5);
  });

  it('survives a plan with no extent at all', () => {
    const framed = frame({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, 2700, SIZE);
    expect(Number.isFinite(framed.distance)).toBe(true);
    expect(framed.distance).toBeGreaterThan(0);
  });
});

describe('the camera — panning', () => {
  it('slides the target across the floor without changing height', () => {
    const moved = pan(cameraAt({ distance: 5000, pitch: Math.PI / 4 }), 1000, 0);
    expect(moved.target.x).toBeCloseTo(1000, 6);
    expect(moved.target.z).toBe(0);
  });

  it('moves in the direction the camera is facing, not the world', () => {
    const moved = pan(cameraAt({ distance: 5000, yaw: Math.PI / 2 }), 1000, 0);
    // Turned a quarter turn, "right" on screen is now down the page.
    expect(moved.target.x).toBeCloseTo(0, 6);
    expect(moved.target.y).toBeCloseTo(1000, 6);
  });
});
