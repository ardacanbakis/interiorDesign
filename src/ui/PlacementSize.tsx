import { getDefinition } from '../core/catalog/registry.ts';
import { type ItemDefinition } from '../core/catalog/types.ts';
import { useEditorStore } from '../state/store.ts';
import { LengthInput } from './LengthInput.tsx';

/**
 * How big it will be, decided before it goes down.
 *
 * Sizing an object after placing it means placing it twice: once to find out
 * it is the wrong size, again once it is right. The standard sizes and the
 * three dimensions are here instead, in the catalogue where the object was
 * just chosen, and the ghost on the plan follows them as they change — so what
 * you are pointing at is what you will get.
 *
 * Inline rather than a dialog on purpose. A dialog would have to be dismissed
 * every time, which would spoil the common case of taking the default size and
 * clicking straight onto the plan.
 */
export function PlacementSize() {
  const kind = useEditorStore((state) => state.placeItemKind);
  const size = useEditorStore((state) => state.placeItemSize);
  const setSize = useEditorStore((state) => state.setPlaceItemSize);
  const unit = useEditorStore((state) => state.document.unit);

  if (!kind || !size) return null;

  let definition: ItemDefinition;
  try {
    definition = getDefinition(kind);
  } catch {
    return null;
  }

  // Which standard size, if any, the current numbers still match. Shown as the
  // selected option so the dropdown tells the truth after a nudge.
  const matching = definition.presets.find(
    (preset) =>
      preset.width === size.width && preset.depth === size.depth && preset.height === size.height,
  );

  return (
    <div
      className="flex flex-col gap-2 rounded border p-2"
      data-testid="placement-size"
      style={{ borderColor: 'var(--surface-border-strong)', background: 'var(--surface-app)' }}
    >
      <p className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        {definition.label} — size before placing
      </p>

      {definition.presets.length > 0 && (
        <select
          aria-label="Standard size"
          data-testid="placement-preset"
          value={matching?.name ?? ''}
          onChange={(event) => {
            const preset = definition.presets.find((entry) => entry.name === event.target.value);
            if (preset) {
              setSize({ width: preset.width, depth: preset.depth, height: preset.height });
            }
          }}
          className="w-full rounded border px-2 py-1 text-xs"
          style={{
            background: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            borderColor: 'var(--surface-border-strong)',
          }}
        >
          <option value="">Custom</option>
          {definition.presets.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name}
            </option>
          ))}
        </select>
      )}

      <div className="grid grid-cols-2 gap-2">
        <LengthInput
          label="Width"
          value={size.width}
          unit={unit}
          min={10}
          max={10_000}
          onChange={(width) => setSize({ width })}
        />
        <LengthInput
          label="Depth"
          value={size.depth}
          unit={unit}
          min={10}
          max={10_000}
          onChange={(depth) => setSize({ depth })}
        />
      </div>

      <LengthInput
        label="Height"
        value={size.height}
        unit={unit}
        min={10}
        max={4_000}
        onChange={(height) => setSize({ height })}
      />

      <p className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
        Click the plan to place it. Every measurement is still editable afterwards.
      </p>
    </div>
  );
}
