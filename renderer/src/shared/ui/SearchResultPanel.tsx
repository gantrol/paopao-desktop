import type { SearchResult } from '@/shared/lib/search';

function getResultTypeLabel(result: SearchResult) {
  if (result.type === 'stream-title') return '流';
  if (result.type === 'stream-message') return '泡泡';
  if (result.type === 'thread-reply') return '评论';
  if (result.type === 'sorting-box') return '箱';
  if (result.type === 'sorting-layer') return '层';
  if (result.type === 'sorting-column') return '列';
  if (result.type === 'sorting-source') return '来源';
  return '卡片';
}

export function SearchResultPanel({
  results,
  selectedIndex,
  hasMore,
  total,
  emptyText,
  compact = false,
  onSelect,
  onSelectIndex,
  onLoadMore,
  onRunAuxiliaryAction,
}: {
  results: SearchResult[];
  selectedIndex: number;
  hasMore: boolean;
  total: number;
  emptyText: string;
  compact?: boolean;
  onSelect: (result: SearchResult) => void;
  onSelectIndex: (index: number) => void;
  onLoadMore: () => void;
  onRunAuxiliaryAction?: (result: SearchResult) => void;
}) {
  if (results.length === 0) {
    return (
      <div className={`search-result-panel ${compact ? 'is-compact' : ''}`}>
        <div className="search-result-empty">{emptyText}</div>
      </div>
    );
  }

  let previousSectionLabel = '';

  return (
    <div className={`search-result-panel ${compact ? 'is-compact' : ''}`}>
      <div className="search-result-scroll">
        {results.map((result, index) => {
          const showSection = result.sectionLabel !== previousSectionLabel;
          previousSectionLabel = result.sectionLabel;

          return (
            <div key={result.id}>
              {showSection ? (
                <div className="search-result-section">{result.sectionLabel}</div>
              ) : null}
              <div
                className={`search-result-row ${selectedIndex === index ? 'is-selected' : ''}`}
                onMouseEnter={() => onSelectIndex(index)}
              >
                <button
                  type="button"
                  className="search-result-main"
                  onClick={() => onSelect(result)}
                >
                  <span className="search-result-badge">{getResultTypeLabel(result)}</span>
                  <span className="search-result-copy">
                    <strong>{result.title}</strong>
                    {result.preview ? <span>{result.preview}</span> : null}
                    <em>{result.meta}</em>
                  </span>
                </button>
                {result.auxiliaryAction && onRunAuxiliaryAction ? (
                  <button
                    type="button"
                    className="search-result-aux"
                    onClick={() => onRunAuxiliaryAction(result)}
                  >
                    {result.auxiliaryAction.label}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="search-result-footer">
        <span>共 {total} 条</span>
        {hasMore ? (
          <button type="button" className="search-result-more" onClick={onLoadMore}>
            加载更多
          </button>
        ) : null}
      </div>
    </div>
  );
}
