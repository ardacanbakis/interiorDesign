import { getDefinition } from '../core/catalog/registry.ts';
import { type FieldSpec, type ItemDefinition } from '../core/catalog/types.ts';
import { type Floor, type Item } from '../core/model/schema.ts';
import { useEditorStore } from '../state/store.ts';
import { LengthInput } from './LengthInput.tsx';

/**
 * Everything about one object.
 *
 * "I should be able to edit the measurements of every object" is the reason
 * this project exists, so nothing here is read-only: width, depth, height and
 * elevation are always editable, and each kind's own parameters — how many
 * wardrobe doors, which side of the bed you get out of — come straight from
 * its definition. A new object in the catalogue gains its controls here for
 * free, because this panel is built from `definition.fields` rather than from a
 * list of kinds.
 */
export function ItemInspector({ floor, itemId }: { floor: Floor; itemId: string }) {
  const updateItem = useEditorStore((state) => state.updateItem);
  const removeItem = useEditorStore((state) => state.removeItem);
  const duplicateItem = useEditorStore((state) => state.duplicateItem);
  const unit = useEditorStore((state) => state.document.unit);

  const item = floor.items.find((entry) => entry.id === itemId);
  if (!item) return <Note>That object is no longer there.</Note>;

  let definition: ItemDefinition;
  try {
    definition = getDefinition(item.kind);
  } catch {
    return <Note>This object’s type ({item.kind}) is not in the catalogue.</Note>;
  }

  const setParam = (key: string, value: number | string | boolean) =>
    updateItem(itemId, { params: { ...item.params, [key]: value } });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {item.label}
        </p>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {definition.label}
        </span>
      </div>

      {definition.presets.length > 0 && (
        <Field label="Size">
          <select
            aria-label="Standard size"
            data-testid="item-preset"
            // Never sticky: the item's numbers are the truth, and a preset is
            // just a way of setting three of them at once. Showing one as
            // "current" after the width has been nudged would be a lie.
            value=""
            onChange={(event) => {
              const preset = definition.presets.find((entry) => entry.name === event.target.value);
              if (!preset) return;
              updateItem(itemId, {
                width: preset.width,
                depth: preset.depth,
                height: preset.height,
              });
            }}
            className="w-full rounded border px-2 py-1 text-xs"
            style={{
              background: 'var(--surface-raised)',
              color: 'var(--text-primary)',
              borderColor: 'var(--surface-border-strong)',
            }}
          >
            <option value="">Choose a standard size…</option>
            {definition.presets.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <LengthInput
        label="Width"
        value={item.width}
        unit={unit}
        min={10}
        max={10_000}
        onChange={(width) => updateItem(itemId, { width })}
      />
      <LengthInput
        label="Depth"
        value={item.depth}
        unit={unit}
        min={10}
        max={10_000}
        onChange={(depth) => updateItem(itemId, { depth })}
      />
      <LengthInput
        label="Height"
        value={item.height}
        unit={unit}
        min={10}
        max={4_000}
        onChange={(height) => updateItem(itemId, { height })}
        hint="The whole object, including anything standing up from it."
      />
      <LengthInput
        label="Off the floor"
        value={item.elevation}
        unit={unit}
        min={0}
        max={3_000}
        onChange={(elevation) => updateItem(itemId, { elevation })}
        hint={
          item.mount === 'floor'
            ? 'Zero for anything standing on the floor.'
            : 'Height of the underside above the floor.'
        }
      />

      <Field label={`Turned ${Math.round(item.rotation)}°`}>
        <div className="flex gap-1">
          <StepButton
            label="−90°"
            onClick={() => updateItem(itemId, { rotation: item.rotation - 90 })}
          />
          <StepButton
            label="+90°"
            onClick={() => updateItem(itemId, { rotation: item.rotation + 90 })}
          />
          <input
            type="range"
            min={0}
            max={359}
            value={Math.round(item.rotation) % 360}
            aria-label="Rotation"
            data-testid="item-rotation"
            onChange={(event) => updateItem(itemId, { rotation: Number(event.target.value) })}
            className="min-w-0 flex-1"
          />
        </div>
      </Field>

      {definition.fields.map((field) => (
        <ParamField
          key={field.key}
          field={field}
          item={item}
          unit={unit}
          onChange={(value) => setParam(field.key, value)}
        />
      ))}

      <div className="mt-1 flex gap-1">
        <button
          type="button"
          data-testid="duplicate-item"
          onClick={() => duplicateItem(itemId)}
          className="flex-1 rounded border py-1.5 text-xs font-medium"
          style={{
            borderColor: 'var(--surface-border-strong)',
            color: 'var(--text-secondary)',
          }}
        >
          Duplicate
        </button>
        <button
          type="button"
          data-testid="delete-item"
          onClick={() => removeItem(itemId)}
          className="flex-1 rounded border py-1.5 text-xs font-medium"
          style={{
            borderColor: 'var(--color-severity-error)',
            color: 'var(--color-severity-error)',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** One kind-specific parameter, rendered from its own declared shape. */
function ParamField({
  field,
  item,
  unit,
  onChange,
}: {
  field: FieldSpec;
  item: Item;
  unit: 'mm' | 'cm' | 'm';
  onChange: (value: number | string | boolean) => void;
}) {
  const value = item.params[field.key];

  if (field.kind === 'length') {
    return (
      <LengthInput
        label={field.label}
        value={typeof value === 'number' ? value : 0}
        unit={unit}
        {...(field.min === undefined ? {} : { min: field.min })}
        {...(field.max === undefined ? {} : { max: field.max })}
        {...(field.hint === undefined ? {} : { hint: field.hint })}
        onChange={onChange}
      />
    );
  }

  if (field.kind === 'count') {
    return (
      <Field label={field.label} hint={field.hint}>
        <input
          type="number"
          value={typeof value === 'number' ? value : 0}
          min={field.min ?? 0}
          max={field.max ?? 99}
          step={1}
          aria-label={field.label}
          data-testid={`item-param-${field.key}`}
          onKeyDown={(event) => event.stopPropagation()}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(Math.round(next));
          }}
          className="tabular w-full rounded border px-2 py-1 text-xs"
          style={{
            background: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            borderColor: 'var(--surface-border-strong)',
          }}
        />
      </Field>
    );
  }

  if (field.kind === 'toggle') {
    return (
      <label
        className="flex items-center gap-2 text-[11px]"
        style={{ color: 'var(--text-secondary)' }}
      >
        <input
          type="checkbox"
          checked={value === true}
          data-testid={`item-param-${field.key}`}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label}
      </label>
    );
  }

  return (
    <Field label={field.label} hint={field.hint}>
      <select
        value={typeof value === 'string' ? value : ''}
        aria-label={field.label}
        data-testid={`item-param-${field.key}`}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border px-2 py-1 text-xs"
        style={{
          background: 'var(--surface-raised)',
          color: 'var(--text-primary)',
          borderColor: 'var(--surface-border-strong)',
        }}
      >
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function StepButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Rotate ${label}`}
      className="tabular rounded border px-2 py-1 text-[11px]"
      style={{ borderColor: 'var(--surface-border-strong)', color: 'var(--text-secondary)' }}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </span>
      )}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}
