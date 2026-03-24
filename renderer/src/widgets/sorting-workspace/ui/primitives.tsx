import {
  useLayoutEffect,
  useRef,
  type RefObject,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { BoxIcon, PanelLeftIcon, TableIcon } from './icons';
import { cx } from './utils';
import { useClampedMenuPosition } from '../../../shared/lib/useClampedMenuPosition';

export function ViewSwitcher({
  value,
  onChange,
}: {
  value: 'kanban' | 'canvas' | 'table';
  onChange: (nextValue: 'kanban' | 'canvas' | 'table') => void;
}) {
  const options: Array<{ value: 'kanban' | 'canvas' | 'table'; label: string; icon: React.ReactNode }> = [
    { value: 'kanban', label: '看板', icon: <BoxIcon size={14} /> },
    { value: 'canvas', label: '画布', icon: <PanelLeftIcon size={14} /> },
    { value: 'table', label: '数据表', icon: <TableIcon size={14} /> },
  ];

  return (
    <div className="inline-flex items-center rounded-full border border-black/10 bg-white p-1 shadow-sm">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx(
            'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
            value === option.value ? 'bg-[var(--bubble-me)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-black/[0.04]',
          )}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function DragPortal({
  children,
  isDragging,
}: {
  children: React.ReactElement;
  isDragging: boolean;
}) {
  if (!isDragging || typeof document === 'undefined') {
    return children;
  }
  return createPortal(children, document.body);
}

export function SortingContextMenu({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}) {
  const { ref, pos } = useClampedMenuPosition(x, y, [children]);

  return (
    <div
      ref={ref}
      className="s-menu"
      style={{ top: pos.y, left: pos.x }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function SortingMenuDivider() {
  return <div className="s-menu-divider" />;
}

export function CommitInput({
  inputRef,
  defaultValue,
  className,
  placeholder,
  onSubmit,
  onCancel,
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
  defaultValue?: string;
  className: string;
  placeholder?: string;
  onSubmit: (value: string, input?: HTMLInputElement | null) => void | Promise<void>;
  onCancel: () => void;
}) {
  const submitLockRef = useRef(false);

  const triggerSubmit = (value: string, input?: HTMLInputElement | null) => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    void Promise.resolve(onSubmit(value, input)).finally(() => {
      submitLockRef.current = false;
    });
  };

  return (
    <input
      ref={inputRef}
      defaultValue={defaultValue}
      className={className}
      placeholder={placeholder}
      onBlur={(event) => triggerSubmit(event.currentTarget.value, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          triggerSubmit(event.currentTarget.value, event.currentTarget);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}
