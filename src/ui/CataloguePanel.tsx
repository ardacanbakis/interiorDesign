import { useMemo, useState } from 'react';

import { CATALOG, definitionsForRoom, populatedCategories } from '../core/catalog/registry.ts';
import { CATEGORY_LABELS, type ItemDefinition } from '../core/catalog/types.ts';
import { type RoomType } from '../core/graph/roomIdentity.ts';
import { roomsOf } from '../core/model/derive.ts';
import { activeFloor, useEditorStore } from '../state/store.ts';
import { PlacementSize } from './PlacementSize.tsx';

/**
 * The object catalogue.
 *
 * Choosing something here is what arms the placing tool — there is no separate
 * "now switch to the furniture tool" step, because picking a wardrobe is
 * already an unambiguous statement of intent.
 *
 * Ordered by the selected room rather than filtered by it. A desk in a bedroom
 * and a bookshelf in a kitchen are both perfectly ordinary, and a catalogue
 * that hides them is merely annoying; one that puts beds first when a bedroom
 * is selected is helpful.
 */
export function CataloguePanel() {
  const floor = useEditorStore(activeFloor);
  const selection = useEditorStore((state) => state.selection);
  const armed = useEditorStore((state) => state.placeItemKind);
  const arm = useEditorStore((state) => state.setPlaceItemKind);

  const [query, setQuery] = useState('');

  // The type of the selected room, when one is selected — what the ordering
  // keys off.
  const roomType = useMemo<RoomType | null>(() => {
    const target = selection.find((entry) => entry.kind === 'room');
    if (!floor || !target) return null;
    return roomsOf(floor).find((room) => room.props.id === target.id)?.props.type ?? null;
  }, [floor, selection]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const ordered = needle ? CATALOG : definitionsForRoom(roomType);
    if (!needle) return ordered;

    return ordered.filter(
      (entry) =>
        entry.label.toLowerCase().includes(needle) ||
        entry.kind.includes(needle) ||
        CATEGORY_LABELS[entry.category].toLowerCase().includes(needle),
    );
  }, [query, roomType]);

  // While searching, grouping by category fights the results; a flat list of
  // what matched is what you are looking at.
  const grouped = query.trim().length === 0;

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={query}
        placeholder="Search objects"
        aria-label="Search objects"
        data-testid="catalogue-search"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
        className="w-full rounded border px-2 py-1 text-xs"
        style={{
          background: 'var(--surface-raised)',
          color: 'var(--text-primary)',
          borderColor: 'var(--surface-border-strong)',
        }}
      />

      {armed && (
        <>
          <PlacementSize />
          <p className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
            It turns to face away from whatever wall it lands against; hold Alt to place it free.
            Escape puts it down.
          </p>
        </>
      )}

      {roomType && grouped && (
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Ordered for a {roomType}. Everything else is still below.
        </p>
      )}

      {matches.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Nothing matches “{query}”.
        </p>
      )}

      {grouped ? (
        populatedCategories(matches).map((category) => (
          <section key={category} className="flex flex-col gap-1">
            <h3
              className="text-[10px] font-semibold tracking-wider uppercase"
              style={{ color: 'var(--text-muted)' }}
            >
              {CATEGORY_LABELS[category]}
            </h3>
            <List
              definitions={matches.filter((entry) => entry.category === category)}
              armed={armed}
              onPick={arm}
            />
          </section>
        ))
      ) : (
        <List definitions={matches} armed={armed} onPick={arm} />
      )}
    </div>
  );
}

function List({
  definitions,
  armed,
  onPick,
}: {
  definitions: readonly ItemDefinition[];
  armed: string | null;
  onPick: (kind: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {definitions.map((definition) => {
        const active = definition.kind === armed;
        return (
          <li key={definition.kind}>
            <button
              type="button"
              aria-pressed={active}
              data-testid={`catalogue-${definition.kind}`}
              onClick={() => onPick(definition.kind)}
              className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-xs"
              style={{
                background: active ? 'var(--color-accent-500)' : 'transparent',
                color: active ? '#fff' : 'var(--text-primary)',
              }}
            >
              <span className="truncate">{definition.label}</span>
              <span
                className="tabular shrink-0 text-[10px]"
                style={{ color: active ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)' }}
              >
                {definition.defaults.width / 10}×{definition.defaults.depth / 10}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
