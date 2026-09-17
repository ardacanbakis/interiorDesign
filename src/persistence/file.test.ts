import { describe, expect, it } from 'vitest';

import { createDocument } from '../core/model/document.ts';
import { graphFromSegments, rectangleSegments } from '../core/graph/wallGraph.ts';
import { FILE_EXTENSION, parseDocumentFile, serializeDocument, suggestFilename } from './file.ts';
import { createMemoryStore, summarise } from './store.ts';

function sampleDocument(name = 'Ev') {
  let counter = 0;
  const document = createDocument({
    name,
    now: () => new Date('2026-03-04T10:00:00.000Z'),
    newId: () => `id${++counter}`,
  });

  return {
    ...document,
    floors: [
      {
        ...document.floors[0]!,
        graph: graphFromSegments(rectangleSegments(0, 0, 4000, 3000, 'exterior')),
      },
    ],
  };
}

describe('serializeDocument / parseDocumentFile', () => {
  it('round-trips a document exactly', () => {
    const original = sampleDocument();
    const result = parseDocumentFile(serializeDocument(original));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual(original);
  });

  it('writes readable, version-stamped JSON', () => {
    const text = serializeDocument(sampleDocument());

    expect(text).toContain('"schemaVersion": 1');
    expect(text.split('\n').length).toBeGreaterThan(10);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('rejects text that is not JSON, and says so plainly', () => {
    const result = parseDocumentFile('this is not a plan');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not valid JSON/i);
  });

  it('rejects JSON that is not a plan', () => {
    const result = parseDocumentFile('{"hello":"world"}');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no version number/i);
  });

  it('rejects a truncated file rather than loading half a house', () => {
    const text = serializeDocument(sampleDocument());
    expect(parseDocumentFile(text.slice(0, text.length / 2)).ok).toBe(false);
  });

  it('reports which field is damaged', () => {
    const broken = JSON.parse(serializeDocument(sampleDocument()));
    broken.floors[0].ceilingHeight = 'quite tall';

    const result = parseDocumentFile(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(' ')).toContain('ceilingHeight');
  });
});

describe('suggestFilename', () => {
  const on = new Date('2026-03-04T10:00:00.000Z');

  it('uses the plan name and the date', () => {
    expect(suggestFilename(sampleDocument('Bizim Ev'), on)).toBe(
      `Bizim-Ev-2026-03-04${FILE_EXTENSION}`,
    );
  });

  it('strips characters that break filesystems', () => {
    expect(suggestFilename(sampleDocument('a/b\\c:d*e?f"g<h>i|j'), on)).toBe(
      `abcdefghij-2026-03-04${FILE_EXTENSION}`,
    );
  });

  it('collapses whitespace runs', () => {
    expect(suggestFilename(sampleDocument('  Yazlık    Ev  '), on)).toBe(
      `Yazlık-Ev-2026-03-04${FILE_EXTENSION}`,
    );
  });

  it('falls back when the name leaves nothing usable', () => {
    expect(suggestFilename(sampleDocument('???'), on)).toBe(`house-2026-03-04${FILE_EXTENSION}`);
    expect(suggestFilename(sampleDocument('   '), on)).toBe(`house-2026-03-04${FILE_EXTENSION}`);
  });

  it('caps the length', () => {
    const name = suggestFilename(sampleDocument('x'.repeat(500)), on);
    expect(name.length).toBeLessThan(100);
  });

  it('never produces a leading dot, which would hide the file', () => {
    expect(suggestFilename(sampleDocument('.hidden'), on).startsWith('.')).toBe(false);
  });
});

describe('createMemoryStore', () => {
  it('writes, reads and lists documents', async () => {
    const store = createMemoryStore();
    const document = sampleDocument('Ev');

    expect(await store.list()).toHaveLength(0);

    await store.write(document);

    expect(await store.list()).toEqual([summarise(document)]);
    expect(await store.read(document.id)).toEqual(document);
  });

  it('returns null for a document that is not there', async () => {
    expect(await createMemoryStore().read('nope')).toBeNull();
  });

  it('overwrites on a second write', async () => {
    const store = createMemoryStore();
    await store.write(sampleDocument('First'));
    await store.write({ ...sampleDocument('Second'), id: sampleDocument('First').id });

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.name).toBe('Second');
  });

  it('stores a snapshot, so a later mutation cannot reach back into it', async () => {
    const store = createMemoryStore();
    const document = sampleDocument();
    await store.write(document);

    document.name = 'Changed after saving';

    const readBack = (await store.read(document.id)) as { name: string };
    expect(readBack.name).toBe('Ev');
  });

  it('lists most recently updated first', async () => {
    const store = createMemoryStore();
    await store.write({ ...sampleDocument('Older'), id: 'a', updatedAt: '2026-01-01T00:00:00Z' });
    await store.write({ ...sampleDocument('Newer'), id: 'b', updatedAt: '2026-06-01T00:00:00Z' });

    expect((await store.list()).map((entry) => entry.name)).toEqual(['Newer', 'Older']);
  });

  it('removes and clears', async () => {
    const store = createMemoryStore([sampleDocument('One'), { ...sampleDocument('Two'), id: 'x' }]);
    expect(await store.list()).toHaveLength(2);

    await store.remove('x');
    expect(await store.list()).toHaveLength(1);

    await store.clear();
    expect(await store.list()).toHaveLength(0);
  });

  it('accepts a seed', async () => {
    const store = createMemoryStore([sampleDocument('Seeded')]);
    expect((await store.list())[0]!.name).toBe('Seeded');
  });
});

describe('summarise', () => {
  it('describes a document without loading all of it', () => {
    const document = sampleDocument('Ev');
    expect(summarise(document)).toEqual({
      id: document.id,
      name: 'Ev',
      updatedAt: document.updatedAt,
      floorCount: 1,
    });
  });
});
