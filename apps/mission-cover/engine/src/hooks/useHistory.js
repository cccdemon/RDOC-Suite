import { useState, useRef, useCallback } from 'react';

/**
 * Custom hook for undo/redo state management.
 * Supports debounced updates for sliders and rapid changes.
 */
export default function useHistory(initialState, maxHistory = 50) {
  const [history, setHistory] = useState([initialState]);
  const [pointer, setPointer] = useState(0);
  const lastUpdateTime = useRef(0);
  const debounceMs = 300;

  const state = history[pointer];

  const setState = useCallback((newStateOrFn, skipDebounce = false) => {
    const now = Date.now();
    const shouldCollapse = !skipDebounce && (now - lastUpdateTime.current) < debounceMs;
    lastUpdateTime.current = now;

    setHistory(prev => {
      const currentPointer = pointer;
      const current = prev[currentPointer] ?? prev[prev.length - 1];
      const newState = typeof newStateOrFn === 'function' ? newStateOrFn(current) : newStateOrFn;

      // Cut off any future states after current pointer
      const base = prev.slice(0, currentPointer + 1);

      if (shouldCollapse && base.length > 1) {
        // Replace last entry (debounce for sliders)
        const collapsed = [...base.slice(0, -1), newState];
        const trimmed = collapsed.length > maxHistory ? collapsed.slice(-maxHistory) : collapsed;
        setPointer(trimmed.length - 1);
        return trimmed;
      }

      const updated = [...base, newState];
      const trimmed = updated.length > maxHistory ? updated.slice(-maxHistory) : updated;
      setPointer(trimmed.length - 1);
      return trimmed;
    });
  }, [pointer, maxHistory]);

  const undo = useCallback(() => {
    setPointer(prev => Math.max(0, prev - 1));
  }, []);

  const redo = useCallback(() => {
    setPointer(prev => Math.min(history.length - 1, prev + 1));
  }, [history.length]);

  const reset = useCallback((newState) => {
    setHistory([newState]);
    setPointer(0);
    lastUpdateTime.current = 0;
  }, []);

  return {
    state,
    setState,
    undo,
    redo,
    reset,
    canUndo: pointer > 0,
    canRedo: pointer < history.length - 1
  };
}
