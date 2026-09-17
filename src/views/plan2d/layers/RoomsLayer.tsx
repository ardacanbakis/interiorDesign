import { memo } from 'react';

import { type DerivedRoom } from '../../../core/model/derive.ts';
import { formatArea } from '../../../core/units/length.ts';
import { ringsPath } from '../svgPath.ts';
import { screenPixels, type Viewport } from '../viewport.ts';

/**
 * Room floors and their labels.
 *
 * Drawn from the usable floor outline — inside the walls — rather than the
 * centreline face, so the coloured area on screen is the area the label claims
 * and the area a tape measure would give.
 */
export const RoomsLayer = memo(function RoomsLayer({
  rooms,
  viewport,
  selectedRoomIds,
  onSelectRoom,
}: {
  rooms: readonly DerivedRoom[];
  viewport: Viewport;
  selectedRoomIds: ReadonlySet<string>;
  onSelectRoom?: (roomId: string, additive: boolean) => void;
}) {
  return (
    <g>
      {rooms.map((room) => {
        const selected = selectedRoomIds.has(room.props.id);

        return (
          <path
            key={room.props.id}
            d={ringsPath([room.geometry.outline, ...room.geometry.holes])}
            // Even-odd so the holes punched by columns and partitions read as
            // holes rather than as overlapping fills.
            fillRule="evenodd"
            // Opaque whether selected or not. A translucent selection tint lets
            // the grid show through the room while its neighbours hide it,
            // which reads as noise rather than as selection — so the tint is
            // mixed into the fill instead of layered over it.
            fill={
              selected
                ? 'color-mix(in oklab, var(--color-accent-500) 14%, var(--plan-room-fill))'
                : 'var(--plan-room-fill)'
            }
            stroke={selected ? 'var(--color-accent-500)' : 'none'}
            strokeWidth={selected ? screenPixels(viewport, 2) : 0}
            data-testid={`room-${room.props.id}`}
            data-room-name={room.props.name}
            style={{ cursor: onSelectRoom ? 'pointer' : 'default' }}
            onPointerDown={
              onSelectRoom
                ? (event) => {
                    event.stopPropagation();
                    onSelectRoom(room.props.id, event.shiftKey);
                  }
                : undefined
            }
          />
        );
      })}
    </g>
  );
});

/**
 * Room names, drawn last.
 *
 * A separate layer from the floors because it has to sit *over* the furniture.
 * A bed in the middle of a bedroom is the ordinary case, not the awkward one,
 * and a room label half hidden under it reads as a rendering fault rather than
 * as a plan. Architects solve this by moving the label; automatic placement
 * cannot, so the label wins instead.
 */
export const RoomLabelsLayer = memo(function RoomLabelsLayer({
  rooms,
  viewport,
}: {
  rooms: readonly DerivedRoom[];
  viewport: Viewport;
}) {
  return (
    <g pointerEvents="none">
      {rooms.map((room) => (
        <RoomLabel key={`${room.props.id}-label`} room={room} viewport={viewport} />
      ))}
    </g>
  );
});

function RoomLabel({ room, viewport }: { room: DerivedRoom; viewport: Viewport }) {
  const nameSize = screenPixels(viewport, 13);
  const areaSize = screenPixels(viewport, 11);
  const { x, y } = room.geometry.interiorPoint;

  // Below a certain size the label is unreadable and only adds clutter; the
  // room is still selectable and the inspector still names it.
  const widthOnScreen = Math.sqrt(room.geometry.area) * viewport.scale;
  if (widthOnScreen < 44) return null;

  return (
    <g pointerEvents="none" aria-hidden="true">
      <text
        x={x}
        y={y - areaSize * 0.4}
        textAnchor="middle"
        fontSize={nameSize}
        fontWeight={500}
        fill="var(--plan-ink)"
        style={halo(nameSize)}
      >
        {room.props.name}
      </text>
      <text
        x={x}
        y={y + nameSize * 0.9}
        textAnchor="middle"
        fontSize={areaSize}
        fill="var(--plan-dim)"
        style={{ fontVariantNumeric: 'tabular-nums', ...halo(areaSize) }}
      >
        {formatArea(room.geometry.area)} m²
      </text>
    </g>
  );
}

/** Paint the stroke behind the glyphs, so text stays readable over anything. */
function halo(size: number) {
  return {
    paintOrder: 'stroke' as const,
    stroke: 'var(--plan-room-fill)',
    strokeWidth: size / 4,
    strokeLinejoin: 'round' as const,
  };
}
