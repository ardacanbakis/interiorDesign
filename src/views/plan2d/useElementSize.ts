import { useEffect, useState, type RefObject } from 'react';

import { type ViewportSize } from './viewport.ts';

/**
 * Track an element's size.
 *
 * The plan's coordinate mapping depends on the canvas's pixel size, so this has
 * to follow window resizes, the inspector opening, and the browser zoom
 * changing — not just the first layout.
 *
 * Starts at zero and reports the real size after the first observation. Callers
 * must cope with a zero size for one frame; `viewport.ts` guards its own
 * divisions, and rendering a plan into no space is harmless.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): ViewportSize {
  const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      // `contentRect` rather than `getBoundingClientRect`: it excludes borders
      // and is not affected by a CSS transform on an ancestor.
      const { width, height } = entry.contentRect;
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
