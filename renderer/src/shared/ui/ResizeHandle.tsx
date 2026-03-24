import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

interface ResizeHandleProps {
  className?: string;
  onDrag: (delta: number) => void;
  ariaLabel?: string;
  limit?: 'min' | 'max' | null;
}

export function ResizeHandle({
  className = '',
  onDrag,
  ariaLabel = '调整面板尺寸',
  limit = null,
}: ResizeHandleProps) {
  const startXRef = useRef<number | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const onDragRef = useRef(onDrag);
  const rafRef = useRef<number | null>(null);
  const pendingDeltaRef = useRef(0);

  useEffect(() => {
    onDragRef.current = onDrag;
  }, [onDrag]);

  const flushPendingDelta = () => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (pendingDeltaRef.current === 0) return;
    const delta = pendingDeltaRef.current;
    pendingDeltaRef.current = 0;
    onDragRef.current(delta);
  };

  const stopDragging = (pointerId?: number) => {
    flushPendingDelta();
    if (
      pointerId !== undefined &&
      handleRef.current &&
      handleRef.current.hasPointerCapture(pointerId)
    ) {
      handleRef.current.releasePointerCapture(pointerId);
    }
    startXRef.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
    document.body.classList.remove('is-resizing');
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (startXRef.current === null) return;
    const delta = event.clientX - startXRef.current;
    startXRef.current = event.clientX;
    pendingDeltaRef.current += delta;
    if (rafRef.current === null) {
      rafRef.current = window.requestAnimationFrame(flushPendingDelta);
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    stopDragging(event.pointerId);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    handleRef.current = event.currentTarget;
    startXRef.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const limitMessage = limit === 'min' ? '已到最小宽度' : limit === 'max' ? '已到最大宽度' : undefined;

  useEffect(() => () => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
  }, []);

  return (
    <button
      ref={handleRef}
      type="button"
      className={className}
      onPointerDown={handlePointerDown}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      data-limit={limit ?? undefined}
      data-limit-message={limitMessage}
    >
      <span className="pane-resize-handle__track" />
    </button>
  );
}
