import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from 'react';

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function InlineSearchControl({
  open,
  panelOpen,
  query,
  placeholder,
  buttonLabel,
  className,
  inputRef,
  resultsView,
  onToggle,
  onQueryChange,
  onInputFocus,
  onInputKeyDown,
  onClear,
}: {
  open: boolean;
  panelOpen: boolean;
  query: string;
  placeholder: string;
  buttonLabel: string;
  className?: string;
  inputRef: RefObject<HTMLInputElement | null>;
  resultsView?: ReactNode;
  onToggle: () => void;
  onQueryChange: (value: string) => void;
  onInputFocus?: () => void;
  onInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) {
  return (
    <div className={`inline-search ${open ? 'is-open' : ''}${className ? ` ${className}` : ''}`}>
      {open ? (
        <div className="inline-search-shell">
          <input
            ref={inputRef}
            type="text"
            className="inline-search-input"
            value={query}
            placeholder={placeholder}
            onChange={(event) => onQueryChange(event.target.value)}
            onFocus={onInputFocus}
            onKeyDown={onInputKeyDown}
          />
          <button
            type="button"
            className="inline-search-close"
            onClick={query ? onClear : onToggle}
            aria-label={query ? '清空搜索' : '关闭搜索'}
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="inline-search-button"
          onClick={onToggle}
          aria-label={buttonLabel}
          title={buttonLabel}
        >
          <SearchGlyph />
        </button>
      )}
      {open && panelOpen && resultsView ? (
        <div className="inline-search-panel">
          {resultsView}
        </div>
      ) : null}
    </div>
  );
}
