/**
 * Loading documents, including ones written by older versions of the app.
 *
 * A plan is worth more than the app that drew it. Someone measures their whole
 * house once; if a later release cannot open that file, the measuring was
 * wasted. So every document carries a `schemaVersion`, and opening one runs it
 * forward through whatever migrations stand between its version and the
 * current one before validating it.
 *
 * Migrations operate on plain unvalidated data, never on typed documents. By
 * definition an old document does not match today's types, so a migration that
 * took a `HouseDocument` would be lying about its input — and would break the
 * moment the current types moved on.
 */

import type { z } from 'zod';

import { CURRENT_SCHEMA_VERSION, type HouseDocument, HouseDocumentSchema } from './schema.ts';

export interface Migration {
  /** The version this migration reads. */
  readonly from: number;
  /** The version it produces — always `from + 1`. */
  readonly to: number;
  /** What changed, for the log and for anyone reading the list later. */
  readonly description: string;
  readonly migrate: (document: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Every migration, in order.
 *
 * Empty because version 1 is the first: there is nothing older to upgrade yet.
 * The machinery is here and tested regardless, because the moment it is needed
 * is the moment there are real documents that cannot afford it to be wrong.
 */
export const MIGRATIONS: readonly Migration[] = [];

export type LoadResult =
  | { readonly ok: true; readonly document: HouseDocument; readonly migrated: boolean }
  | { readonly ok: false; readonly error: string; readonly issues: readonly string[] };

/**
 * Validate and, if needed, upgrade a document that has come from outside —
 * local storage, an imported file, or cloud sync.
 *
 * Never throws. A corrupt file is an ordinary thing to encounter and the caller
 * needs to be able to tell the user which file and why, rather than catch an
 * exception and guess.
 */
export function loadDocument(
  raw: unknown,
  migrations: readonly Migration[] = MIGRATIONS,
): LoadResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Not a plan file.', issues: [] };
  }

  const record = raw as Record<string, unknown>;
  const version = record['schemaVersion'];

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      error: 'This file has no version number, so it cannot be read as a plan.',
      issues: [],
    };
  }

  if (version > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `This plan was saved by a newer version of the app ` +
        `(format ${version}, this version reads up to ${CURRENT_SCHEMA_VERSION}). ` +
        `Update the app to open it.`,
      issues: [],
    };
  }

  let working = record;
  let migrated = false;

  while ((working['schemaVersion'] as number) < CURRENT_SCHEMA_VERSION) {
    const current = working['schemaVersion'] as number;
    const migration = migrations.find((candidate) => candidate.from === current);

    if (!migration) {
      return {
        ok: false,
        error: `No way to upgrade this plan from format ${current} to ${CURRENT_SCHEMA_VERSION}.`,
        issues: [],
      };
    }

    working = { ...migration.migrate(working), schemaVersion: migration.to };
    migrated = true;
  }

  const parsed = HouseDocumentSchema.safeParse(working);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'This plan file is damaged and could not be read.',
      issues: describeIssues(parsed.error),
    };
  }

  return { ok: true, document: parsed.data, migrated };
}

/** Turn Zod's report into lines a person could act on. */
function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 10).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}
