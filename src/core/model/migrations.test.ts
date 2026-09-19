import { describe, expect, it } from 'vitest';

import { createDocument, createFloor, defaultFloorName } from './document.ts';
import { loadDocument, MIGRATIONS, type Migration } from './migrations.ts';
import { CURRENT_SCHEMA_VERSION } from './schema.ts';

const fixedClock = () => new Date('2026-01-15T09:30:00.000Z');

function stableDocument() {
  let counter = 0;
  return createDocument({
    name: 'Ev',
    now: fixedClock,
    newId: () => `id${++counter}`,
  });
}

describe('loadDocument — valid documents', () => {
  it('reads a document the current version wrote', () => {
    const original = stableDocument();
    const result = loadDocument(JSON.parse(JSON.stringify(original)));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual(original);
    expect(result.migrated).toBe(false);
  });

  it('survives a JSON round-trip unchanged', () => {
    const original = stableDocument();
    const result = loadDocument(JSON.parse(JSON.stringify(original)));

    expect(result.ok && JSON.stringify(result.document)).toBe(JSON.stringify(original));
  });
});

describe('loadDocument — rejecting what it cannot read', () => {
  it('rejects things that are not objects', () => {
    for (const input of [null, undefined, 42, 'plan', [], true]) {
      const result = loadDocument(input);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toMatch(/not a plan file/i);
    }
  });

  it('rejects a document with no version', () => {
    const result = loadDocument({ name: 'Ev', floors: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no version number/i);
  });

  it('rejects a version from the future, and says why', () => {
    const result = loadDocument({ ...stableDocument(), schemaVersion: 99 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The message has to be actionable: which format, what this build reads,
    // and what to do about it.
    expect(result.error).toContain('99');
    expect(result.error).toContain(String(CURRENT_SCHEMA_VERSION));
    expect(result.error).toMatch(/update the app/i);
  });

  it('reports what is damaged rather than only that something is', () => {
    const broken = stableDocument() as unknown as Record<string, unknown>;
    const result = loadDocument({
      ...broken,
      floors: [{ ...createFloor('f1', 0, 'Ground floor'), ceilingHeight: 'tall' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toContain('ceilingHeight');
  });

  it('rejects fractional millimetres, which the geometry cannot represent', () => {
    const document = stableDocument();
    const result = loadDocument({
      ...document,
      floors: [{ ...document.floors[0]!, ceilingHeight: 2700.5 }],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects a NaN coordinate rather than letting it reach the geometry', () => {
    const document = stableDocument();
    const floor = document.floors[0]!;
    const result = loadDocument({
      ...document,
      floors: [
        {
          ...floor,
          graph: {
            nodes: { n1: { id: 'n1', x: Number.NaN, y: 0 } },
            walls: {},
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it('never throws, whatever it is handed', () => {
    const nasty: Record<string, unknown> = { schemaVersion: 1 };
    nasty['self'] = nasty;

    expect(() => loadDocument(nasty)).not.toThrow();
    expect(() => loadDocument(new Map())).not.toThrow();
    expect(() => loadDocument(() => undefined)).not.toThrow();
  });
});

describe('loadDocument — migration machinery', () => {
  // Stand-in migrations, so the mechanism is tested on its own terms rather
  // than through whatever the real ones happen to do this month.
  const renameHouse: Migration = {
    from: 1,
    to: 2,
    description: 'test: prefix the name',
    migrate: (document) => ({ ...document, name: `migrated ${String(document['name'])}` }),
  };

  const addField: Migration = {
    from: 2,
    to: 3,
    description: 'test: add a field',
    migrate: (document) => ({ ...document, addedByMigration: true }),
  };

  it('applies a chain of migrations in order', () => {
    const applied: string[] = [];
    const record = (migration: Migration): Migration => ({
      ...migration,
      migrate: (document) => {
        applied.push(migration.description);
        return migration.migrate(document);
      },
    });

    const legacy = { ...stableDocument(), schemaVersion: 1 };
    loadDocument(legacy, [record(renameHouse), record(addField)]);

    // Runs as far as the current version and no further: the step to 3 is
    // there, but there is no version 3 to reach.
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
    expect(applied).toEqual(['test: prefix the name']);
  });

  it('stops when no migration bridges the gap, and says so', () => {
    const result = loadDocument({ ...stableDocument(), schemaVersion: 1 }, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no way to upgrade/i);
  });

  it('runs a migration when the document really is behind', () => {
    // Pretend the current version is ahead by pointing the loader at a
    // migration that lands exactly on it.
    const upgradeToCurrent: Migration = {
      from: CURRENT_SCHEMA_VERSION - 1,
      to: CURRENT_SCHEMA_VERSION,
      description: 'test: bring an older document up to date',
      migrate: (document) => ({ ...document, name: 'upgraded' }),
    };

    const legacy = { ...stableDocument(), schemaVersion: CURRENT_SCHEMA_VERSION - 1 };
    const result = loadDocument(legacy, [upgradeToCurrent]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.name).toBe('upgraded');
    expect(result.migrated).toBe(true);
  });
});

describe('loadDocument — the real migrations', () => {
  it('brings a version-1 plan up to date', () => {
    // A file written before floors carried muted warnings: the field is simply
    // absent. This is a plan somebody actually saved, and it has to open.
    const current = JSON.parse(JSON.stringify(stableDocument())) as Record<string, unknown>;
    const floors = (current['floors'] as Record<string, unknown>[]).map((floor) => {
      const { mutedIssues: _dropped, ...rest } = floor;
      void _dropped;
      return rest;
    });
    const legacy = { ...current, floors, schemaVersion: 1 };

    const result = loadDocument(legacy, MIGRATIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect(result.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.document.floors.map((floor) => floor.mutedIssues)).toEqual([[]]);
  });

  it('leaves a version-1 plan that already has the field alone', () => {
    // Belt and braces: a migration must never overwrite what is there.
    const current = JSON.parse(JSON.stringify(stableDocument())) as Record<string, unknown>;
    const floors = (current['floors'] as Record<string, unknown>[]).map((floor) => ({
      ...floor,
      mutedIssues: ['clearance/i1/wardrobe-swing'],
    }));

    const result = loadDocument({ ...current, floors, schemaVersion: 1 }, MIGRATIONS);

    expect(result.ok && result.document.floors[0]!.mutedIssues).toEqual([
      'clearance/i1/wardrobe-swing',
    ]);
  });

  it('every migration steps exactly one version, and they run in sequence', () => {
    MIGRATIONS.forEach((migration, index) => {
      expect(migration.to).toBe(migration.from + 1);
      expect(migration.from).toBe(1 + index);
    });
    expect(MIGRATIONS.at(-1)?.to).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe('createDocument', () => {
  it('starts with one ground floor, because every house has one', () => {
    const document = stableDocument();

    expect(document.floors).toHaveLength(1);
    expect(document.floors[0]!.level).toBe(0);
    expect(document.floors[0]!.name).toBe('Ground floor');
    expect(document.floors[0]!.graph.walls).toEqual({});
  });

  it('is deterministic when given a clock and an id source', () => {
    expect(stableDocument()).toEqual(stableDocument());
  });

  it('defaults to centimetres for display and millimetres for storage', () => {
    expect(stableDocument().unit).toBe('cm');
  });

  it('uses typical Turkish ceiling heights', () => {
    expect(stableDocument().floors[0]!.ceilingHeight).toBe(2700);
  });

  it('validates against its own schema', () => {
    expect(loadDocument(stableDocument()).ok).toBe(true);
  });
});

describe('createFloor', () => {
  it('stacks floors by their level and floor-to-floor height', () => {
    const ground = createFloor('f1', 0, 'Ground floor');
    const first = createFloor('f2', 1, 'First floor');

    expect(ground.elevation).toBe(0);
    expect(first.elevation).toBe(2700 + 150);
  });

  it('puts a basement below the datum', () => {
    expect(createFloor('f0', -1, 'Basement').elevation).toBe(-(2700 + 150));
  });

  it('honours an explicit elevation', () => {
    expect(createFloor('f2', 1, 'First floor', { elevation: 3000 }).elevation).toBe(3000);
  });
});

describe('defaultFloorName', () => {
  it('names floors the way people do', () => {
    expect(defaultFloorName(0)).toBe('Ground floor');
    expect(defaultFloorName(1)).toBe('First floor');
    expect(defaultFloorName(2)).toBe('Second floor');
    expect(defaultFloorName(-1)).toBe('Basement');
    expect(defaultFloorName(-2)).toBe('Basement 2');
    expect(defaultFloorName(20)).toBe('Floor 20');
  });
});
