import { describe, expect, it } from 'vitest';

import {
  formatArea,
  formatDimensions,
  formatLength,
  fromMm,
  parseLength,
  parseLengthClamped,
  roundMm,
  toMm,
} from './length.ts';

describe('roundMm', () => {
  it('rounds to whole millimetres', () => {
    expect(roundMm(12.4)).toBe(12);
    expect(roundMm(12.6)).toBe(13);
  });

  it('breaks ties symmetrically about zero', () => {
    // Math.round(-0.5) is -0, which would make dragging left behave
    // differently from dragging right.
    expect(roundMm(0.5)).toBe(1);
    expect(roundMm(-0.5)).toBe(-1);
    expect(roundMm(2.5)).toBe(3);
    expect(roundMm(-2.5)).toBe(-3);
  });
});

describe('toMm / fromMm', () => {
  it('converts each unit', () => {
    expect(toMm(240, 'cm')).toBe(2400);
    expect(toMm(2.4, 'm')).toBe(2400);
    expect(toMm(2400, 'mm')).toBe(2400);
  });

  it('round-trips through every unit', () => {
    for (const unit of ['mm', 'cm', 'm'] as const) {
      expect(toMm(fromMm(2400, unit), unit)).toBe(2400);
    }
  });

  it('rounds sub-millimetre input', () => {
    expect(toMm(24.04, 'cm')).toBe(240);
    expect(toMm(24.06, 'cm')).toBe(241);
  });
});

describe('formatLength', () => {
  it('uses sensible defaults per unit', () => {
    expect(formatLength(2400, 'mm')).toBe('2400');
    expect(formatLength(2400, 'cm')).toBe('240');
    expect(formatLength(2400, 'm')).toBe('2.4');
  });

  it('strips trailing zeros so dimension lines stay scannable', () => {
    expect(formatLength(2400, 'cm')).toBe('240');
    expect(formatLength(2405, 'cm')).toBe('240.5');
  });

  it('keeps trailing zeros when asked', () => {
    expect(formatLength(2400, 'cm', { padDecimals: true })).toBe('240.0');
  });

  it('appends the unit when asked', () => {
    expect(formatLength(2400, 'cm', { withUnit: true })).toBe('240 cm');
    expect(formatLength(2400, 'm', { withUnit: true })).toBe('2.4 m');
  });

  it('honours an explicit decimal count', () => {
    expect(formatLength(2456, 'cm', { decimals: 0 })).toBe('246');
    expect(formatLength(2456, 'm', { decimals: 1 })).toBe('2.5');
  });

  it('never renders negative zero', () => {
    expect(formatLength(-0.4, 'mm')).toBe('0');
  });

  it('handles negatives', () => {
    expect(formatLength(-2400, 'cm')).toBe('-240');
  });
});

describe('parseLength', () => {
  it('reads a bare number in the display unit', () => {
    expect(parseLength('240', 'cm')).toBe(2400);
    expect(parseLength('240', 'mm')).toBe(240);
    expect(parseLength('2.4', 'm')).toBe(2400);
  });

  it('lets an explicit suffix override the display unit', () => {
    expect(parseLength('2400mm', 'cm')).toBe(2400);
    expect(parseLength('2.4m', 'cm')).toBe(2400);
    expect(parseLength('240cm', 'm')).toBe(2400);
  });

  it('accepts a decimal comma, as written in Turkey and most of Europe', () => {
    expect(parseLength('2,4 m', 'cm')).toBe(2400);
    expect(parseLength('240,5', 'cm')).toBe(2405);
  });

  it('tolerates whitespace and casing', () => {
    expect(parseLength('  2.4  M  ', 'cm')).toBe(2400);
    expect(parseLength('240 CM', 'mm')).toBe(2400);
  });

  it('accepts a leading decimal point', () => {
    expect(parseLength('.5', 'm')).toBe(500);
  });

  it('accepts negatives, which offsets need', () => {
    expect(parseLength('-30', 'cm')).toBe(-300);
  });

  it('returns null rather than zero for unparseable input', () => {
    // A caller must be able to tell "invalid" from a legitimate zero.
    expect(parseLength('', 'cm')).toBeNull();
    expect(parseLength('   ', 'cm')).toBeNull();
    expect(parseLength('abc', 'cm')).toBeNull();
    expect(parseLength('240 feet', 'cm')).toBeNull();
    expect(parseLength('-', 'cm')).toBeNull();
    expect(parseLength('2.4.5', 'cm')).toBeNull();
    expect(parseLength('1e5', 'cm')).toBeNull();
  });

  it('parses zero', () => {
    expect(parseLength('0', 'cm')).toBe(0);
  });

  it('round-trips with formatLength', () => {
    for (const unit of ['mm', 'cm', 'm'] as const) {
      for (const value of [0, 1, 100, 2400, 12345, -450]) {
        const text = formatLength(value, unit, { decimals: 4 });
        expect(parseLength(text, unit)).toBe(value);
      }
    }
  });
});

describe('parseLengthClamped', () => {
  const range = { min: 100, max: 3000, fallback: 600 };

  it('clamps into range', () => {
    expect(parseLengthClamped('1', 'cm', range)).toBe(100);
    expect(parseLengthClamped('9999', 'cm', range)).toBe(3000);
    expect(parseLengthClamped('50', 'cm', range)).toBe(500);
  });

  it('falls back when unparseable', () => {
    expect(parseLengthClamped('nonsense', 'cm', range)).toBe(600);
  });
});

describe('formatArea', () => {
  it('renders square metres regardless of the length unit', () => {
    // 4m x 3m = 12 m²
    expect(formatArea(4000 * 3000)).toBe('12.00');
    expect(formatArea(3650 * 4200)).toBe('15.33');
  });

  it('honours a decimal count', () => {
    expect(formatArea(4000 * 3000, 1)).toBe('12.0');
  });
});

describe('formatDimensions', () => {
  it('renders a width by depth pair', () => {
    expect(formatDimensions(1600, 2000, 'cm')).toBe('160 × 200');
  });
});
