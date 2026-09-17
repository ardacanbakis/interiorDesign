import { memo } from 'react';

import { allWalls, nodePoint, type WallGraph } from '../../../core/graph/wallGraph.ts';
import { wallPolygon } from '../../../core/graph/wallShapes.ts';
import { polygonPath } from '../svgPath.ts';
import { screenPixels, type Viewport } from '../viewport.ts';

/**
 * The masonry.
 *
 * Every wall is drawn as its own rectangle in one flat colour. Where walls meet,
 * the rectangles overlap and the corner simply fills in — the same picture true
 * mitring would produce, without needing a special case for the three-and-four
 * way junctions that occur at every T in a real house.
 *
 * A second, invisible set of fatter strokes sits on top purely to catch the
 * pointer. A 100mm partition is under two pixels wide when a whole floor is on
 * screen, and something that thin cannot be clicked.
 */
export const WallsLayer = memo(function WallsLayer({
  graph,
  viewport,
  selectedWallIds,
  onSelectWall,
}: {
  graph: WallGraph;
  viewport: Viewport;
  selectedWallIds: ReadonlySet<string>;
  onSelectWall?: (wallId: string, additive: boolean) => void;
}) {
  const walls = allWalls(graph);
  // At least 10px of target, however thin the wall is on screen.
  const hitWidth = screenPixels(viewport, 10);

  return (
    <g>
      {walls.map((wall) => (
        <path
          key={wall.id}
          d={polygonPath(wallPolygon(graph, wall))}
          fill="var(--plan-wall-fill)"
          pointerEvents="none"
        />
      ))}

      {walls.map((wall) => {
        if (!selectedWallIds.has(wall.id)) return null;
        return (
          <path
            key={`${wall.id}-selected`}
            d={polygonPath(wallPolygon(graph, wall))}
            fill="var(--color-accent-500)"
            pointerEvents="none"
          />
        );
      })}

      {onSelectWall &&
        walls.map((wall) => {
          const a = nodePoint(graph, wall.a);
          const b = nodePoint(graph, wall.b);

          return (
            <line
              key={`${wall.id}-hit`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="transparent"
              strokeWidth={Math.max(hitWidth, wall.thickness)}
              strokeLinecap="butt"
              data-testid={`wall-${wall.id}`}
              style={{ cursor: 'pointer' }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectWall(wall.id, event.shiftKey);
              }}
            />
          );
        })}
    </g>
  );
});
