import { DependencyList, useLayoutEffect, useRef, useState } from 'react';

export function useClampedMenuPosition(
  x: number,
  y: number,
  deps: DependencyList = [],
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const padding = 8;
    const rect = node.getBoundingClientRect();
    const maxX = Math.max(padding, window.innerWidth - rect.width - padding);
    const maxY = Math.max(padding, window.innerHeight - rect.height - padding);

    setPos({
      x: Math.min(Math.max(x, padding), maxX),
      y: Math.min(Math.max(y, padding), maxY),
    });
  }, [x, y, ...deps]);

  return { ref, pos };
}
