import { useCallback, useMemo, useState } from 'react';
import {
  buildThreadDraftKey,
  createEmptyDraftState,
  type DraftState,
} from './draft';

interface UseStreamDraftsOptions {
  selectedChatId: string;
  currentConversationId?: string | null;
  threadMsgId?: string | null;
  threadSubItemIndex?: number;
  threadBlockId?: string;
}

export function useStreamDrafts({
  selectedChatId,
  currentConversationId,
  threadMsgId,
  threadSubItemIndex,
  threadBlockId,
}: UseStreamDraftsOptions) {
  const [sessionDrafts, setSessionDrafts] = useState<Record<string, DraftState>>({});
  const [threadDrafts, setThreadDrafts] = useState<Record<string, DraftState>>({});

  const currentDraft = sessionDrafts[selectedChatId] || createEmptyDraftState();

  const currentThreadDraftKey = useMemo(
    () => currentConversationId && threadMsgId
      ? buildThreadDraftKey(currentConversationId, threadMsgId, threadBlockId || (threadSubItemIndex !== undefined ? String(threadSubItemIndex) : undefined))
      : null,
    [currentConversationId, threadMsgId, threadBlockId, threadSubItemIndex],
  );

  const currentThreadDraft = currentThreadDraftKey
    ? (threadDrafts[currentThreadDraftKey] || createEmptyDraftState())
    : createEmptyDraftState();

  const setCurrentDraft = useCallback((updater: (prev: DraftState) => DraftState) => {
    if (!selectedChatId) return;
    setSessionDrafts((prev) => {
      const currentDraft = prev[selectedChatId] || createEmptyDraftState();
      const nextDraft = updater(currentDraft);
      if (nextDraft === currentDraft) return prev;
      return {
        ...prev,
        [selectedChatId]: nextDraft,
      };
    });
  }, [selectedChatId]);

  const updateCurrentThreadDraft = useCallback((updater: (prev: DraftState) => DraftState) => {
    if (!currentThreadDraftKey) return;
    setThreadDrafts((prev) => {
      const currentDraft = prev[currentThreadDraftKey] || createEmptyDraftState();
      const nextDraft = updater(currentDraft);
      if (nextDraft === currentDraft) return prev;
      return {
        ...prev,
        [currentThreadDraftKey]: nextDraft,
      };
    });
  }, [currentThreadDraftKey]);

  const setCurrentThreadDraftText = useCallback((value: string) => {
    updateCurrentThreadDraft((prev) => ({ ...prev, text: value }));
  }, [updateCurrentThreadDraft]);

  return {
    currentDraft,
    currentThreadDraft,
    currentThreadDraftKey,
    setCurrentDraft,
    setCurrentThreadDraftText,
    updateCurrentThreadDraft,
  };
}
