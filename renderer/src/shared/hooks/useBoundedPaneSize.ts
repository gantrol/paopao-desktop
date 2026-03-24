import { useCallback, useEffect, useRef, useState } from 'react';

export type PaneLimit = 'min' | 'max' | null;

interface UseBoundedPaneSizeOptions {
  initial: number;
  min: number;
  max: number;
}

export function useBoundedPaneSize({ initial, min, max }: UseBoundedPaneSizeOptions) {
  const [size, setSize] = useState(initial);
  const [limit, setLimit] = useState<PaneLimit>(null);
  const sizeRef = useRef(initial);
  const limitRef = useRef<PaneLimit>(null);
  const limitTimerRef = useRef<number | null>(null);

  const applyLimit = useCallback((nextLimit: PaneLimit) => {
    limitRef.current = nextLimit;
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
  }, []);

  const applySize = useCallback((nextSize: number) => {
    sizeRef.current = nextSize;
    setSize((prev) => (prev === nextSize ? prev : nextSize));
  }, []);

  const flashLimit = useCallback((nextLimit: Exclude<PaneLimit, null>) => {
    applyLimit(nextLimit);
    if (limitTimerRef.current !== null) {
      window.clearTimeout(limitTimerRef.current);
    }
    limitTimerRef.current = window.setTimeout(() => {
      applyLimit(null);
      limitTimerRef.current = null;
    }, 720);
  }, [applyLimit]);

  const resizeBy = useCallback((delta: number) => {
    const next = sizeRef.current + delta;
    if (next <= min) {
      applySize(min);
      flashLimit('min');
      return min;
    }
    if (next >= max) {
      applySize(max);
      flashLimit('max');
      return max;
    }
    applySize(next);
    if (limitRef.current !== null) {
      applyLimit(null);
    }
    return next;
  }, [applyLimit, applySize, flashLimit, max, min]);

  const setPaneSize = useCallback((nextSize: number) => {
    const clamped = Math.min(max, Math.max(min, nextSize));
    applySize(clamped);
    if (clamped > min && clamped < max && limitRef.current !== null) {
      applyLimit(null);
    }
  }, [applyLimit, applySize, max, min]);

  const getSize = useCallback(() => sizeRef.current, []);

  useEffect(() => () => {
    if (limitTimerRef.current !== null) {
      window.clearTimeout(limitTimerRef.current);
    }
  }, []);

  return {
    size,
    limit,
    resizeBy,
    setSize: setPaneSize,
    getSize,
  };
}
