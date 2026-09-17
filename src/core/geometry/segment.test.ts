import { describe, expect, it } from 'vitest';

import {
  distanceToSegment,
  isPointInsideSegment,
  isPointOnSegment,
  parameterAlong,
  pointAt,
  projectOntoSegment,
  segmentIntersection,
  segmentLength,
  type Segment,
} from './segment.ts';
import { vec2 } from './vec2.ts';

const seg = (ax: number, ay: number, bx: number, by: number): Segment => ({
  a: vec2(ax, ay),
  b: vec2(bx, by),
});

describe('segmentLength / pointAt / parameterAlong', () => {
  const horizontal = seg(0, 0, 1000, 0);

  it('measures length', () => {
    expect(segmentLength(horizontal)).toBe(1000);
    expect(segmentLength(seg(0, 0, 300, 400))).toBe(500);
  });

  it('interpolates along the segment', () => {
    expect(pointAt(horizontal, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAt(horizontal, 0.25)).toEqual({ x: 250, y: 0 });
    expect(pointAt(horizontal, 1)).toEqual({ x: 1000, y: 0 });
  });

  it('locates a point along the segment', () => {
    expect(parameterAlong(horizontal, vec2(250, 0))).toBe(0.25);
    // Off-segment points project onto the infinite line.
    expect(parameterAlong(horizontal, vec2(250, 999))).toBe(0.25);
    expect(parameterAlong(horizontal, vec2(-500, 0))).toBe(-0.5);
    expect(parameterAlong(horizontal, vec2(1500, 0))).toBe(1.5);
  });

  it('reports 0 for a degenerate segment rather than dividing by zero', () => {
    expect(parameterAlong(seg(5, 5, 5, 5), vec2(9, 9))).toBe(0);
  });
});

describe('projectOntoSegment', () => {
  const horizontal = seg(0, 0, 1000, 0);

  it('projects onto the interior', () => {
    expect(projectOntoSegment(horizontal, vec2(400, 300))).toEqual({
      point: { x: 400, y: 0 },
      t: 0.4,
      distance: 300,
    });
  });

  it('clamps beyond the endpoints', () => {
    expect(projectOntoSegment(horizontal, vec2(-500, 0)).t).toBe(0);
    expect(projectOntoSegment(horizontal, vec2(1500, 0)).t).toBe(1);
    expect(projectOntoSegment(horizontal, vec2(1300, 0)).distance).toBe(300);
  });
});

describe('distanceToSegment / isPointOnSegment / isPointInsideSegment', () => {
  const horizontal = seg(0, 0, 1000, 0);

  it('measures perpendicular distance, not distance to the infinite line', () => {
    expect(distanceToSegment(horizontal, vec2(500, 120))).toBe(120);
    // Past the end, the nearest point is the endpoint itself.
    expect(distanceToSegment(horizontal, vec2(1300, 0))).toBe(300);
  });

  it('detects points on the segment within tolerance', () => {
    expect(isPointOnSegment(horizontal, vec2(500, 0), 1)).toBe(true);
    expect(isPointOnSegment(horizontal, vec2(500, 0.5), 1)).toBe(true);
    expect(isPointOnSegment(horizontal, vec2(500, 5), 1)).toBe(false);
  });

  it('distinguishes interior points from endpoints', () => {
    // This is the "does this point split that wall?" test — a point landing on
    // an existing node must not trigger a split.
    expect(isPointInsideSegment(horizontal, vec2(500, 0), 1)).toBe(true);
    expect(isPointInsideSegment(horizontal, vec2(0, 0), 1)).toBe(false);
    expect(isPointInsideSegment(horizontal, vec2(1000, 0), 1)).toBe(false);
    expect(isPointInsideSegment(horizontal, vec2(0.5, 0), 1)).toBe(false);
    expect(isPointInsideSegment(horizontal, vec2(2000, 0), 1)).toBe(false);
  });
});

describe('segmentIntersection', () => {
  it('finds a proper crossing', () => {
    const result = segmentIntersection(seg(0, 0, 1000, 0), seg(500, -500, 500, 500));
    expect(result.kind).toBe('point');
    if (result.kind !== 'point') throw new Error('expected a point');
    expect(result.point).toEqual({ x: 500, y: 0 });
    expect(result.t).toBeCloseTo(0.5);
    expect(result.u).toBeCloseTo(0.5);
  });

  it('finds a T-junction, where one segment ends on the other', () => {
    const result = segmentIntersection(seg(0, 0, 1000, 0), seg(500, 0, 500, 500));
    expect(result.kind).toBe('point');
    if (result.kind !== 'point') throw new Error('expected a point');
    expect(result.point).toEqual({ x: 500, y: 0 });
    expect(result.u).toBe(0);
  });

  it('finds an L-corner, where the segments share an endpoint', () => {
    const result = segmentIntersection(seg(0, 0, 1000, 0), seg(1000, 0, 1000, 800));
    expect(result.kind).toBe('point');
    if (result.kind !== 'point') throw new Error('expected a point');
    expect(result.point).toEqual({ x: 1000, y: 0 });
    expect(result.t).toBe(1);
    expect(result.u).toBe(0);
  });

  it('rejects segments whose infinite lines cross outside their extents', () => {
    expect(segmentIntersection(seg(0, 0, 100, 0), seg(500, -500, 500, 500)).kind).toBe('none');
  });

  it('rejects parallel but offset segments', () => {
    expect(segmentIntersection(seg(0, 0, 1000, 0), seg(0, 500, 1000, 500)).kind).toBe('none');
  });

  it('rejects a zero-length segment', () => {
    expect(segmentIntersection(seg(5, 5, 5, 5), seg(0, 5, 10, 5)).kind).toBe('none');
  });

  describe('collinear cases — drawing a wall along one that already exists', () => {
    it('reports a partial overlap', () => {
      const result = segmentIntersection(seg(0, 0, 1000, 0), seg(500, 0, 1500, 0));
      expect(result.kind).toBe('collinear');
      if (result.kind !== 'collinear') throw new Error('expected collinear');
      expect(result.overlap[0]).toEqual({ x: 500, y: 0 });
      expect(result.overlap[1]).toEqual({ x: 1000, y: 0 });
    });

    it('reports full containment', () => {
      const result = segmentIntersection(seg(0, 0, 1000, 0), seg(200, 0, 800, 0));
      expect(result.kind).toBe('collinear');
      if (result.kind !== 'collinear') throw new Error('expected collinear');
      expect(result.overlap[0]).toEqual({ x: 200, y: 0 });
      expect(result.overlap[1]).toEqual({ x: 800, y: 0 });
    });

    it('orders the overlap along the first segment regardless of the second direction', () => {
      const result = segmentIntersection(seg(0, 0, 1000, 0), seg(1500, 0, 500, 0));
      expect(result.kind).toBe('collinear');
      if (result.kind !== 'collinear') throw new Error('expected collinear');
      expect(result.overlap[0]).toEqual({ x: 500, y: 0 });
      expect(result.overlap[1]).toEqual({ x: 1000, y: 0 });
    });

    it('treats collinear segments meeting at a single point as no overlap', () => {
      // End-to-end walls in a straight line share only a node; that is handled
      // by node snapping, not by overlap splitting.
      expect(segmentIntersection(seg(0, 0, 1000, 0), seg(1000, 0, 2000, 0)).kind).toBe('none');
    });

    it('rejects collinear segments that do not reach each other', () => {
      expect(segmentIntersection(seg(0, 0, 1000, 0), seg(1500, 0, 2000, 0)).kind).toBe('none');
    });

    it('handles vertical collinear overlap', () => {
      const result = segmentIntersection(seg(0, 0, 0, 1000), seg(0, 400, 0, 1400));
      expect(result.kind).toBe('collinear');
      if (result.kind !== 'collinear') throw new Error('expected collinear');
      expect(result.overlap[0]).toEqual({ x: 0, y: 400 });
      expect(result.overlap[1]).toEqual({ x: 0, y: 1000 });
    });
  });

  describe('tolerance', () => {
    /**
     * The wall graph calls in with a tolerance of 1 — one millimetre — not the
     * 1e-6 default. These cases run at that tolerance because a threshold that
     * is dimensionally wrong still looks fine at 1e-6 and falls apart at 1.
     */
    describe('at the 1mm tolerance the wall graph uses', () => {
      it('does not mistake perpendicular walls for parallel ones', () => {
        const result = segmentIntersection(seg(0, 0, 1000, 0), seg(500, -500, 500, 500), 1);
        expect(result.kind).toBe('point');
        if (result.kind !== 'point') throw new Error('expected a point');
        expect(result.point).toEqual({ x: 500, y: 0 });
      });

      it('still finds a crossing between a long wall and a short one', () => {
        expect(segmentIntersection(seg(0, 0, 10_000, 0), seg(500, -60, 500, 60), 1).kind).toBe(
          'point',
        );
      });

      it('still reports a genuine collinear overlap', () => {
        expect(segmentIntersection(seg(0, 0, 1000, 0), seg(500, 0, 1500, 0), 1).kind).toBe(
          'collinear',
        );
      });

      it('treats walls offset by more than a millimetre as separate', () => {
        expect(segmentIntersection(seg(0, 0, 1000, 0), seg(0, 3, 1000, 3), 1).kind).toBe('none');
      });

      it('treats walls offset by less than a millimetre as collinear', () => {
        // Below the tolerance the two are the same wall as far as the model
        // is concerned, and must be merged rather than stacked.
        expect(segmentIntersection(seg(0, 0, 1000, 0), seg(200, 0.4, 800, 0.4), 1).kind).toBe(
          'collinear',
        );
      });
    });

    it('scales the parallel test with segment length', () => {
      // A 10m wall and a 100mm one crossing at a shallow angle must still be
      // found. A fixed absolute threshold would miss this.
      const long = seg(0, 0, 10_000, 0);
      const shortSteep = seg(5000, -50, 5010, 50);
      expect(segmentIntersection(long, shortSteep).kind).toBe('point');
    });

    it('still finds a corner when the endpoints are a hair apart', () => {
      // Floating-point drift must not leave the graph non-planar.
      const result = segmentIntersection(
        seg(0, 0, 1000, 0),
        seg(1000.0000001, 0, 1000.0000001, 800),
      );
      expect(result.kind).toBe('point');
    });
  });
});
