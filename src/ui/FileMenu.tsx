import { useRef, useState } from 'react';

import { downloadDocument, readDocumentFile } from '../persistence/file.ts';
import { useEditorStore } from '../state/store.ts';
import { Tooltip } from './Tooltip.tsx';

/**
 * Save to a file, and open one.
 *
 * A plan lives in this browser's storage, which is per-device and per-browser:
 * measure a room on the laptop and it is not on the phone. That is the right
 * default — a floor plan of where you live is not something to put on someone
 * else's server by accident — but it does mean a file is the way a plan travels,
 * and until now nothing in the app offered one.
 *
 * The file is plain, indented JSON with its version at the top, so a plan
 * outlives the app that drew it.
 */
export function FileMenu() {
  const document = useEditorStore((state) => state.document);
  const openDocument = useEditorStore((state) => state.openDocument);
  const newDocument = useEditorStore((state) => state.newDocument);

  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-1">
      <ToolbarButton
        label="Save to a file"
        shortcut="Ctrl+S"
        testId="save-file"
        onClick={() => downloadDocument(document)}
      >
        <path
          d="M9 3v8m0 0L6 8m3 3l3-3M4 12v2a1 1 0 001 1h8a1 1 0 001-1v-2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </ToolbarButton>

      <ToolbarButton
        label="Open a file"
        shortcut="Ctrl+O"
        testId="open-file"
        onClick={() => input.current?.click()}
      >
        <path
          d="M9 15V7m0 0L6 10m3-3l3 3M4 6V4a1 1 0 011-1h8a1 1 0 011 1v2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </ToolbarButton>

      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="file-input"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          // Cleared straight away, so picking the same file twice in a row
          // still fires a change event.
          event.target.value = '';
          if (!file) return;

          const result = await readDocumentFile(file);
          if (result.ok) {
            setProblem(null);
            openDocument(result.document);
          } else {
            setProblem(result.error);
          }
        }}
      />

      {problem && (
        <div
          role="alert"
          className="max-w-xs truncate text-[11px]"
          data-testid="file-error"
          style={{ color: 'var(--color-severity-error)' }}
          title={problem}
        >
          {problem}
        </div>
      )}

      <ToolbarButton
        label="Start a new plan"
        shortcut="Ctrl+N"
        testId="new-file"
        onClick={() => {
          // Replacing what is on screen is worth a question; the current plan
          // is only in this browser and there may be no copy of it anywhere.
          if (!useEditorStore.getState().dirty || window.confirm(DISCARD_WARNING)) {
            setProblem(null);
            newDocument();
          }
        }}
      >
        <path
          d="M5 3h5l3 3v9a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </ToolbarButton>
    </div>
  );
}

const DISCARD_WARNING =
  'Start a new plan? The current one is only stored in this browser — save it to a file first if you want to keep it.';

function ToolbarButton({
  label,
  shortcut,
  testId,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  testId: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        data-testid={testId}
        className="grid h-8 w-8 place-items-center rounded transition-colors"
        style={{ color: 'var(--text-secondary)' }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          {children}
        </svg>
      </button>
    </Tooltip>
  );
}
