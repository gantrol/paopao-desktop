import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

type CompactListSearchProps = {
  value: string;
  placeholder: string;
  buttonLabel: string;
  className?: string;
  onChange: (value: string) => void;
};

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function CompactListSearch({
  value,
  placeholder,
  buttonLabel,
  className,
  onChange,
}: CompactListSearchProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const hasQuery = Boolean(value.trim());

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (value) {
      onChange('');
    }
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`list-search-control${open ? ' is-open' : ''}${hasQuery ? ' is-active' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="list-search-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-label={buttonLabel}
        title={buttonLabel}
      >
        <SearchGlyph />
      </button>
      {open ? (
        <div className="list-search-panel">
          <label className="list-search-shell">
            <span className="list-search-icon" aria-hidden="true">
              <SearchGlyph />
            </span>
            <input
              ref={inputRef}
              type="search"
              className="list-search-input"
              value={value}
              placeholder={placeholder}
              autoComplete="off"
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            <button
              type="button"
              className="list-search-clear"
              onClick={() => {
                if (value) {
                  onChange('');
                  inputRef.current?.focus();
                  return;
                }
                setOpen(false);
              }}
              aria-label={value ? '清空搜索' : '关闭搜索'}
            >
              ×
            </button>
          </label>
        </div>
      ) : null}
    </div>
  );
}
