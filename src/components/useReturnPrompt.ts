import { useCallback, useEffect, useRef } from 'react';
import { awayLongEnough } from '../lib/tracker';

/**
 * Remembers one item (a listing the user just opened) and calls `onReturn` with it when the user comes back to this
 * tab after being away for at least `minAwayMs`. A quick glance at the other tab does nothing.
 * The item is handed back at most once.
 */
export function useReturnPrompt<T>(onReturn: (item: T) => void, minAwayMs = 8000) {
  const pending = useRef<T | null>(null);
  const hiddenAt = useRef<number | null>(null);
  const callback = useRef(onReturn);

  useEffect(() => { callback.current = onReturn; });

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = pending.current ? Date.now() : null;
        return;
      }
      const item = pending.current;
      if (item && awayLongEnough(hiddenAt.current, Date.now(), minAwayMs)) {
        pending.current = null;
        hiddenAt.current = null;
        callback.current(item);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [minAwayMs]);

  const watch = useCallback((item: T) => { pending.current = item; hiddenAt.current = null; }, []);
  const clear = useCallback(() => { pending.current = null; hiddenAt.current = null; }, []);
  return { watch, clear };
}
