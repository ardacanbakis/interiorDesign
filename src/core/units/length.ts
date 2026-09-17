/**
 * Lengths.
 *
 * Everything in the document model is stored as an **integer number of
 * millimetres**. There is exactly one internal unit, so units can never be
 * mixed up in arithmetic, and integer storage means no floating-point drift
 * accumulates as walls are dragged around. Conversion happens only at the
 * display boundary — this module is that boundary.
 *
 * `Mm` is a plain alias rather than a branded type on purpose. Branding earns
 * its keep when several units coexist in the model; here there is only one, and
 * branding would force a cast on every `a + b` for no safety gained.
 */

export type Mm = number;

/** Square millimetres. Room areas are large enough that this needs a name. */
export type Mm2 = number;

export type LengthUnit = 'mm' | 'cm' | 'm';

const MM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
};

/** Sensible decimal places for each unit when displaying a length. */
const DEFAULT_DECIMALS: Record<LengthUnit, number> = {
  mm: 0,
  cm: 1,
  m: 3,
};

const UNIT_SUFFIX: Record<LengthUnit, string> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
};

/**
 * Round to a whole millimetre, symmetrically about zero.
 *
 * `Math.round` breaks ties towards positive infinity, so -0.5 becomes -0 while
 * 0.5 becomes 1. Offsets in this app can be negative, and an asymmetric round
 * makes a wall dragged left behave differently from one dragged right.
 */
export function roundMm(value: number): Mm {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Convert a value expressed in `unit` into millimetres. */
export function toMm(value: number, unit: LengthUnit): Mm {
  return roundMm(value * MM_PER_UNIT[unit]);
}

/** Convert millimetres into `unit`. The result is not rounded. */
export function fromMm(value: Mm, unit: LengthUnit): number {
  return value / MM_PER_UNIT[unit];
}

export interface FormatLengthOptions {
  /** Decimal places. Defaults to something sensible for the unit. */
  decimals?: number;
  /** Append the unit suffix, e.g. `240 cm`. Defaults to false. */
  withUnit?: boolean;
  /** Keep trailing zeros, e.g. `240.0` instead of `240`. Defaults to false. */
  padDecimals?: boolean;
}

/**
 * Render a length for display.
 *
 * Trailing zeros are stripped by default: a dimension line reading `240` is
 * easier to scan than `240.0`, and the difference matters when a plan is
 * covered in them.
 */
export function formatLength(
  value: Mm,
  unit: LengthUnit,
  options: FormatLengthOptions = {},
): string {
  const decimals = options.decimals ?? DEFAULT_DECIMALS[unit];
  const converted = fromMm(value, unit);

  let text = converted.toFixed(decimals);

  if (!options.padDecimals && text.includes('.')) {
    text = text.replace(/\.?0+$/, '');
  }

  // `(-0).toFixed(0)` is "-0", which is never what anyone wants to read.
  if (text === '-0') text = '0';

  return options.withUnit ? `${text} ${UNIT_SUFFIX[unit]}` : text;
}

/**
 * Parse a length typed by a person.
 *
 * A bare number is interpreted in `defaultUnit`, so someone working in
 * centimetres can type `240`. An explicit suffix always wins, so `2.4m` and
 * `2400mm` are both understood regardless of the current display unit.
 *
 * Both `.` and `,` are accepted as the decimal separator — Turkish and most of
 * continental Europe write `2,4 m`, and rejecting that would be its own small
 * daily annoyance.
 *
 * Returns `null` for anything unparseable, so callers can distinguish "empty or
 * invalid" from a legitimate zero.
 */
export function parseLength(input: string, defaultUnit: LengthUnit): Mm | null {
  const match = /^\s*(-?\d*(?:[.,]\d+)?)\s*(mm|cm|m)?\s*$/i.exec(input);
  if (!match) return null;

  const [, rawNumber, rawUnit] = match;
  if (rawNumber === undefined || rawNumber === '' || rawNumber === '-') return null;

  const value = Number(rawNumber.replace(',', '.'));
  if (!Number.isFinite(value)) return null;

  const unit = rawUnit ? (rawUnit.toLowerCase() as LengthUnit) : defaultUnit;
  return toMm(value, unit);
}

/**
 * Parse a length and clamp it into a range, falling back when unparseable.
 * Used by the inspector inputs, which must always end up with a usable number.
 */
export function parseLengthClamped(
  input: string,
  defaultUnit: LengthUnit,
  range: { min: Mm; max: Mm; fallback: Mm },
): Mm {
  const parsed = parseLength(input, defaultUnit);
  if (parsed === null) return range.fallback;
  return Math.min(range.max, Math.max(range.min, parsed));
}

/**
 * Render an area in square metres.
 *
 * Areas are always shown in m² whatever the length unit — nobody describes a
 * room as 120,000 cm².
 */
export function formatArea(value: Mm2, decimals = 2): string {
  const squareMetres = value / 1_000_000;
  return squareMetres.toFixed(decimals);
}

/** Render a width × depth pair, e.g. `160 × 200`. */
export function formatDimensions(width: Mm, depth: Mm, unit: LengthUnit): string {
  return `${formatLength(width, unit)} × ${formatLength(depth, unit)}`;
}

/** The suffix for a unit, for labelling inputs. */
export function unitSuffix(unit: LengthUnit): string {
  return UNIT_SUFFIX[unit];
}
