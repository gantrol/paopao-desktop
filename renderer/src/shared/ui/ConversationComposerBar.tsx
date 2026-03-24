import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEventHandler,
  type DragEventHandler,
  type MutableRefObject,
} from 'react';
import { CompoundBubbleIcon } from '@/shared/icons/AvatarIcons';
import { publicIcon } from '@/shared/lib/asset';
const COMPOSER_MIN_HEIGHT = 24;
const COMPOSER_MAX_HEIGHT = 160;

function resizeTextarea(node: HTMLTextAreaElement | null) {
  if (!node) return false;
  node.style.height = `${COMPOSER_MIN_HEIGHT}px`;
  node.style.overflowY = 'hidden';
  if (node.value.length === 0) return false;
  const nextHeight = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, node.scrollHeight));
  node.style.height = `${nextHeight}px`;
  if (node.scrollHeight > COMPOSER_MAX_HEIGHT) {
    node.style.overflowY = 'auto';
  }
  return nextHeight > COMPOSER_MIN_HEIGHT;
}

interface ConversationComposerBarProps {
  value: string;
  placeholder: string;
  canSend: boolean;
  disabled?: boolean;
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>;
  onValueChange: (value: string) => void;
  onSend: () => void;
  onFocus?: () => void;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  onDrop?: DragEventHandler<HTMLTextAreaElement>;
  onDragOver?: DragEventHandler<HTMLTextAreaElement>;
  showCompoundButton?: boolean;
  compoundDisabled?: boolean;
  onCompoundClick?: () => void;
  showPlusButton?: boolean;
  plusDisabled?: boolean;
  plusActive?: boolean;
  onPlusClick?: () => void;
}

export function ConversationComposerBar({
  value,
  placeholder,
  canSend,
  disabled = false,
  textareaRef,
  onValueChange,
  onSend,
  onFocus,
  onPaste,
  onDrop,
  onDragOver,
  showCompoundButton = true,
  compoundDisabled = false,
  onCompoundClick,
  showPlusButton = true,
  plusDisabled = false,
  plusActive = false,
  onPlusClick,
}: ConversationComposerBarProps) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const syncTextareaLayout = useCallback((node: HTMLTextAreaElement | null) => {
    const nextExpanded = resizeTextarea(node);
    setIsExpanded((prev) => (prev === nextExpanded ? prev : nextExpanded));
  }, []);

  const scheduleResize = useCallback(() => {
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      syncTextareaLayout(innerRef.current);
    });
  }, [syncTextareaLayout]);

  useLayoutEffect(() => {
    syncTextareaLayout(innerRef.current);
  }, [syncTextareaLayout, value]);

  useEffect(() => {
    const node = innerRef.current;
    if (!node) return undefined;
    const container = node.parentElement;
    if (!container || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      scheduleResize();
    });
    observer.observe(container);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [scheduleResize]);

  useEffect(() => () => {
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }
  }, []);

  const assignTextareaRef = (node: HTMLTextAreaElement | null) => {
    innerRef.current = node;
    if (textareaRef) {
      textareaRef.current = node;
    }
    syncTextareaLayout(node);
  };

  const handleSend = () => {
    if (disabled || !canSend) return;
    onSend();
  };

  const handleCompoundClick = () => {
    if (disabled || compoundDisabled || !onCompoundClick) return;
    onCompoundClick();
  };

  const handlePlusClick = () => {
    if (disabled || plusDisabled || !onPlusClick) return;
    onPlusClick();
  };

  return (
    <div className={`input-bar ${isExpanded ? 'is-expanded' : 'is-compact'}`}>
      <button type="button" className="icon-btn is-disabled" disabled aria-label="语音输入暂不可用">
        <img src={publicIcon('input_voice.svg')} alt="voice" />
      </button>
      <div className="input-field-shell">
        <textarea
          ref={assignTextareaRef}
          className="input-field"
          rows={1}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onValueChange(event.target.value);
            syncTextareaLayout(event.target);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSend();
              syncTextareaLayout(event.currentTarget);
            }
          }}
          onFocus={onFocus}
          onInput={(event) => syncTextareaLayout(event.currentTarget)}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={onDragOver}
        />
      </div>
      {showCompoundButton ? (
        <button
          type="button"
          className={`icon-btn ${disabled || compoundDisabled || !onCompoundClick ? 'is-disabled' : ''}`}
          onClick={handleCompoundClick}
          disabled={disabled || compoundDisabled || !onCompoundClick}
          aria-label="添加内容块"
        >
          <CompoundBubbleIcon style={{ width: 28, height: 28 }} />
        </button>
      ) : null}
      {showPlusButton ? (
        <button
          type="button"
          className={`icon-btn ${plusActive ? 'rotated' : ''} ${disabled || plusDisabled || !onPlusClick ? 'is-disabled' : ''}`}
          onClick={handlePlusClick}
          disabled={disabled || plusDisabled || !onPlusClick}
          aria-label="打开更多工具"
        >
          <img src={publicIcon('input_plus.svg')} alt="plus" />
        </button>
      ) : null}
      <button
        type="button"
        className={`icon-btn send-btn ${canSend && !disabled ? 'active' : ''}`}
        onClick={handleSend}
        disabled={disabled || !canSend}
        aria-label="发送消息"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
      </button>
    </div>
  );
}
