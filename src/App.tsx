import { useEffect, useMemo, useState } from 'react';

import { restoreMostRecent, useAutosave } from './persistence/autosave.ts';
import { createDocumentStore, type DocumentStore } from './persistence/store.ts';
import { useEditorStore } from './state/store.ts';
import { AppShell } from './ui/AppShell.tsx';

export function App() {
  // One store for the life of the app. `createDocumentStore` also reports
  // whether it found real storage — private-browsing profiles block IndexedDB,
  // and someone measuring a house deserves to be told their work will not be
  // kept rather than to find out afterwards.
  const { store, persistent } = useMemo(() => createDocumentStore(), []);

  const restoring = useRestoreOnStartup(store);
  const saveState = useAutosave(store);

  return <AppShell saveState={saveState} persistent={persistent} restoring={restoring} />;
}

/**
 * Reopen whatever was being worked on last.
 *
 * Runs once. Failure is not fatal: the app keeps the empty document it started
 * with, and `restoreMostRecent` has already left the unreadable plan on disk
 * for a later version to make sense of.
 */
function useRestoreOnStartup(store: DocumentStore): boolean {
  const [restoring, setRestoring] = useState(true);
  const openDocument = useEditorStore((state) => state.openDocument);

  useEffect(() => {
    let cancelled = false;

    void restoreMostRecent(store)
      .then((document) => {
        if (cancelled || !document) return;
        openDocument(document);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });

    return () => {
      cancelled = true;
    };
  }, [store, openDocument]);

  return restoring;
}
