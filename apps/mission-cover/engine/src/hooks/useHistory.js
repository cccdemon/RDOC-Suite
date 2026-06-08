import { useState, useRef, useCallback } from 'react';

/**
 * Custom hook for undo/redo state management.
 * Supports debounced updates for sliders and rapid changes.
 *
 * History + pointer live in ONE state object and are only ever read/written
 * inside the functional updater. Reading `pointer` from a `useCallback` closure
 * (the previous design) was stale across React-batched calls: a drag fires two
 * setState calls per mousemove (X then Y) before a re-render, so the second call
 * sliced the history at the stale pointer and discarded the first call's update
 * (positions silently dropped). Threading everything through `prev` fixes that.
 */
export default function useHistory(initialState, maxHistory = 50) {
  const [hist, setHist] = useState({ stack: [initialState], pointer: 0 });
  const lastUpdateTime = useRef(0);
  const debounceMs = 300;

  const state = hist.stack[hist.pointer];

  const setState = useCallback((newStateOrFn, skipDebounce = false) => {
    const now = Date.now();
    const shouldCollapse = !skipDebounce && (now - lastUpdateTime.current) < debounceMs;
    lastUpdateTime.current = now;

    setHist(prev => {
      const current = prev.stack[prev.pointer] ?? prev.stack[prev.stack.length - 1];
      const newState = typeof newStateOrFn === 'function' ? newStateOrFn(current) : newStateOrFn;

      // Cut off any future (redo) states after the current pointer.
      const base = prev.stack.slice(0, prev.pointer + 1);

      let stack;
      if (shouldCollapse && base.length > 1) {
        // Replace the last entry (debounce for sliders / rapid drags).
        stack = [...base.slice(0, -1), newState];
      } else {
        stack = [...base, newState];
      }
      if (stack.length > maxHistory) stack = stack.slice(-maxHistory);
      return { stack, pointer: stack.length - 1 };
    });
  }, [maxHistory]);

  const undo = useCallback(() => {
    setHist(prev => ({ ...prev, pointer: Math.max(0, prev.pointer - 1) }));
  }, []);

  const redo = useCallback(() => {
    setHist(prev => ({ ...prev, pointer: Math.min(prev.stack.length - 1, prev.pointer + 1) }));
  }, []);

  const reset = useCallback((newState) => {
    setHist({ stack: [newState], pointer: 0 });
    lastUpdateTime.current = 0;
  }, []);

  return {
    state,
    setState,
    undo,
    redo,
    reset,
    canUndo: hist.pointer > 0,
    canRedo: hist.pointer < hist.stack.length - 1
  };
}
