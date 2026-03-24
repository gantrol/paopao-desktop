import { useCallback, useEffect, useRef } from 'react';
import { type ConversationBotStreamEvent, type MachineRunStreamEvent } from '@/entities/bot';
import { mergeStreamingMessages, syncChannelSummary, type ChatChannel, type ChatRecord } from '@/entities/conversation';
import {
  createTextBubbleBlock,
  getMessageBlocks,
  withNormalizedMessageBlocks,
  type MessageData,
} from '@/entities/message';
import { getDesktopBridge } from '@/shared/lib/desktop-bridge';

interface UseConversationStreamingOptions {
  bridge: ReturnType<typeof getDesktopBridge>;
  selectedChatId: string;
  activeChat: string;
  msgAreaRef: React.RefObject<HTMLDivElement | null>;
  setChannels: React.Dispatch<React.SetStateAction<ChatChannel[]>>;
}

export function useConversationStreaming({
  bridge,
  selectedChatId,
  activeChat,
  msgAreaRef,
  setChannels,
}: UseConversationStreamingOptions) {
  type StreamingDeltaEvent =
    Extract<ConversationBotStreamEvent, { type: 'reply-delta' }>
    | Extract<MachineRunStreamEvent, { type: 'run-delta' }>;
  type StreamingCompleteEvent =
    Extract<ConversationBotStreamEvent, { type: 'reply-complete' }>
    | Extract<MachineRunStreamEvent, { type: 'run-complete' }>;

  const mergeMessageMetadata = useCallback((
    message: MessageData,
    patch: Record<string, unknown>,
  ) => ({
    ...(message.metadata && typeof message.metadata === 'object' ? message.metadata : {}),
    ...patch,
  }), []);

  const buildAiTrace = useCallback((event: ConversationBotStreamEvent | MachineRunStreamEvent, patch?: Record<string, unknown>) => {
    const isMachineEvent = event.type.startsWith('run-');
    const base = {
      kind: isMachineEvent ? 'machine-run' : 'bot-reply',
      botId: event.botId,
      botName: event.botName,
      phase: event.type === 'reply-complete' || event.type === 'run-complete'
        ? 'done'
        : event.type === 'reply-error' || event.type === 'run-error'
          ? 'error'
          : event.type === 'run-requires-action'
            ? 'requires-action'
            : 'streaming',
      ...(isMachineEvent
        ? {
          runtimeType: (event as MachineRunStreamEvent).runtimeType,
          runId: (event as MachineRunStreamEvent).runId,
          sourceMessageId: (event as MachineRunStreamEvent).sourceMessageId,
          targetBlockId: (event as MachineRunStreamEvent).targetBlockId || null,
        }
        : {
          triggerMessageId: (event as ConversationBotStreamEvent).triggerMessageId,
        }),
    };
    return {
      ...base,
      ...(patch || {}),
    };
  }, []);

  const ensureStreamingPlaceholder = useCallback((message: MessageData) => {
    const blocks = getMessageBlocks(message);
    if (blocks.length > 0) {
      return withNormalizedMessageBlocks(message);
    }
    return withNormalizedMessageBlocks({
      ...message,
      blocks: [createTextBubbleBlock('')],
    });
  }, []);

  const appendStreamingText = useCallback((message: MessageData, delta: string) => {
    const blocks = getMessageBlocks(message);
    const textBlocks = blocks.filter((block) => block.type === 'text');
    if (textBlocks.length === 0) {
      return withNormalizedMessageBlocks({
        ...message,
        blocks: [...blocks, createTextBubbleBlock(delta)],
      });
    }
    const lastTextBlock = textBlocks[textBlocks.length - 1];
    return withNormalizedMessageBlocks({
      ...message,
      blocks: blocks.map((block) => (
        block.id === lastTextBlock.id
          ? { ...block, text: `${block.text || ''}${delta}` }
          : block
      )),
    });
  }, []);

  const selectedChatIdRef = useRef(selectedChatId);
  const activeChatRef = useRef(activeChat);
  const streamingMessagesRef = useRef<Map<string, Map<string, MessageData>>>(new Map());
  const typewriterQueuesRef = useRef<Map<string, {
    conversationId: string;
    messageId: string;
    chars: string[];
    completed: boolean;
    timerId: number | null;
  }>>(new Map());

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  const shouldAutoFollowConversation = useCallback((conversationId: string) => {
    if (selectedChatIdRef.current !== conversationId || activeChatRef.current !== 'assistant') {
      return false;
    }
    const node = msgAreaRef.current;
    if (!node) return false;
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    return distanceToBottom < 120;
  }, [msgAreaRef]);

  const scheduleConversationAutoFollow = useCallback((conversationId: string, shouldStick: boolean) => {
    if (!shouldStick) return;
    if (selectedChatIdRef.current !== conversationId || activeChatRef.current !== 'assistant') {
      return;
    }
    window.requestAnimationFrame(() => {
      if (!msgAreaRef.current) return;
      msgAreaRef.current.scrollTop = msgAreaRef.current.scrollHeight;
    });
  }, [msgAreaRef]);

  const storeStreamingMessage = useCallback((conversationId: string, message: MessageData) => {
    const conversationMap = streamingMessagesRef.current.get(conversationId) || new Map<string, MessageData>();
    conversationMap.set(message.id, message);
    streamingMessagesRef.current.set(conversationId, conversationMap);

    const shouldStick = shouldAutoFollowConversation(conversationId);
    setChannels((prev) => prev.map((channel) => {
      if (channel.id !== conversationId) return channel;
      const existingIndex = channel.messages.findIndex((item) => item.id === message.id);
      const nextMessages = existingIndex >= 0
        ? channel.messages.map((item) => (item.id === message.id ? message : item))
        : [...channel.messages, message];
      return syncChannelSummary(channel, nextMessages);
    }));
    scheduleConversationAutoFollow(conversationId, shouldStick);
  }, [scheduleConversationAutoFollow, setChannels, shouldAutoFollowConversation]);

  const patchStreamingMessage = useCallback((
    conversationId: string,
    messageId: string,
    updater: (message: MessageData) => MessageData,
    fallback?: MessageData | null,
  ) => {
    const conversationMap = streamingMessagesRef.current.get(conversationId) || new Map<string, MessageData>();
    const currentMessage = conversationMap.get(messageId) || fallback || null;
    if (!currentMessage) return null;

    const nextMessage = updater(currentMessage);
    conversationMap.set(messageId, nextMessage);
    streamingMessagesRef.current.set(conversationId, conversationMap);

    const shouldStick = shouldAutoFollowConversation(conversationId);
    setChannels((prev) => prev.map((channel) => {
      if (channel.id !== conversationId) return channel;
      const existingIndex = channel.messages.findIndex((item) => item.id === messageId);
      const nextMessages = existingIndex >= 0
        ? channel.messages.map((item) => (item.id === messageId ? nextMessage : item))
        : [...channel.messages, nextMessage];
      return syncChannelSummary(channel, nextMessages);
    }));
    scheduleConversationAutoFollow(conversationId, shouldStick);
    return nextMessage;
  }, [scheduleConversationAutoFollow, setChannels, shouldAutoFollowConversation]);

  const clearTypewriterQueue = useCallback((conversationId: string, messageId: string) => {
    const queueKey = `${conversationId}:${messageId}`;
    const queue = typewriterQueuesRef.current.get(queueKey);
    if (queue?.timerId) {
      window.clearTimeout(queue.timerId);
    }
    typewriterQueuesRef.current.delete(queueKey);
  }, []);

  const drainTypewriterQueue = useCallback((conversationId: string, messageId: string) => {
    const queueKey = `${conversationId}:${messageId}`;
    const queue = typewriterQueuesRef.current.get(queueKey);
    if (!queue) return;

    queue.timerId = null;

    if (queue.chars.length > 0) {
      const batchSize = queue.completed
        ? Math.min(queue.chars.length, Math.max(4, Math.ceil(queue.chars.length / 5)))
        : queue.chars.length > 48
          ? 6
          : queue.chars.length > 24
            ? 3
            : 1;
      const nextChunk = queue.chars.splice(0, batchSize).join('');
      patchStreamingMessage(conversationId, messageId, (message) => withNormalizedMessageBlocks({
        ...appendStreamingText(message, nextChunk),
        status: 'streaming',
        metadata: mergeMessageMetadata(message, {
          streamingState: 'streaming',
          streamingLocal: true,
        }),
      }));
    }

    if (queue.chars.length === 0 && queue.completed) {
      patchStreamingMessage(conversationId, messageId, (message) => ({
        ...message,
        status: 'success',
        metadata: mergeMessageMetadata(message, {
          streamingState: 'done',
          streamingLocal: true,
        }),
      }));
      clearTypewriterQueue(conversationId, messageId);
      return;
    }

    queue.timerId = window.setTimeout(() => {
      drainTypewriterQueue(conversationId, messageId);
    }, 18);
  }, [clearTypewriterQueue, mergeMessageMetadata, patchStreamingMessage]);

  const enqueueTypewriterDelta = useCallback((event: StreamingDeltaEvent) => {
    const queueKey = `${event.conversationId}:${event.messageId}`;
    const queue = typewriterQueuesRef.current.get(queueKey) || {
      conversationId: event.conversationId,
      messageId: event.messageId,
      chars: [],
      completed: false,
      timerId: null,
    };
    queue.chars.push(...Array.from(event.delta));
    typewriterQueuesRef.current.set(queueKey, queue);
    if (queue.timerId === null) {
      drainTypewriterQueue(event.conversationId, event.messageId);
    }
  }, [drainTypewriterQueue]);

  const completeTypewriterMessage = useCallback((event: StreamingCompleteEvent) => {
    const queueKey = `${event.conversationId}:${event.messageId}`;
    const queue = typewriterQueuesRef.current.get(queueKey) || {
      conversationId: event.conversationId,
      messageId: event.messageId,
      chars: [],
      completed: false,
      timerId: null,
    };

    const currentMessage =
      streamingMessagesRef.current.get(event.conversationId)?.get(event.messageId) || null;

    const renderedContent =
      typeof currentMessage?.content === 'string' ? currentMessage.content : '';

    const queuedContent = queue.chars.join('');
    const visibleOrQueuedContent = `${renderedContent}${queuedContent}`;

    let remainder = '';

    if (event.content.startsWith(visibleOrQueuedContent)) {
      remainder = event.content.slice(visibleOrQueuedContent.length);
    } else if (event.content.startsWith(renderedContent)) {
      // 发生不同步时，避免把已排队内容再追加一遍
      queue.chars = [];
      remainder = event.content.slice(renderedContent.length);
    } else {
      // 极端情况下直接重建尾部，避免重复追加
      queue.chars = [];
      remainder = event.content;
    }

    if (remainder) {
      queue.chars.push(...Array.from(remainder));
    }

    queue.completed = true;
    typewriterQueuesRef.current.set(queueKey, queue);

    if (queue.timerId === null) {
      drainTypewriterQueue(event.conversationId, event.messageId);
    }
  }, [drainTypewriterQueue]);

  const clearConversationStreamingState = useCallback((conversationId: string, options?: { removeMessages?: boolean }) => {
    const conversationMap = streamingMessagesRef.current.get(conversationId);
    const streamingMessageIds = conversationMap ? [...conversationMap.keys()] : [];
    streamingMessageIds.forEach((messageId) => clearTypewriterQueue(conversationId, messageId));
    streamingMessagesRef.current.delete(conversationId);

    if (!options?.removeMessages || streamingMessageIds.length === 0) {
      return;
    }

    setChannels((prev) => prev.map((channel) => {
      if (channel.id !== conversationId) return channel;
      return syncChannelSummary(
        channel,
        channel.messages.filter((message) => !streamingMessageIds.includes(message.id)),
      );
    }));
  }, [clearTypewriterQueue, setChannels]);

  useEffect(() => {
    return () => {
      typewriterQueuesRef.current.forEach((queue) => {
        if (queue.timerId) {
          window.clearTimeout(queue.timerId);
        }
      });
      typewriterQueuesRef.current.clear();
      streamingMessagesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!bridge) return undefined;

    return bridge.ai.onConversationBotStream((event) => {
      if (!event || typeof event !== 'object') return;

      if (event.type === 'reply-start') {
        storeStreamingMessage(event.conversationId, ensureStreamingPlaceholder({
          ...event.message,
          status: 'streaming',
          metadata: mergeMessageMetadata(event.message, {
            streamingState: 'streaming',
            streamingLocal: true,
            aiTrace: buildAiTrace(event),
          }),
        }));
        return;
      }

      if (event.type === 'reply-delta') {
        patchStreamingMessage(event.conversationId, event.messageId, (message) => ({
          ...message,
          metadata: mergeMessageMetadata(message, {
            aiTrace: buildAiTrace(event, {
              model: event.model || '',
            }),
          }),
        }));
        enqueueTypewriterDelta(event);
        return;
      }

      if (event.type === 'reply-complete') {
        completeTypewriterMessage(event);
        patchStreamingMessage(event.conversationId, event.messageId, (message) => ({
          ...message,
          metadata: mergeMessageMetadata(message, {
            aiTrace: buildAiTrace(event, {
              model: event.model || '',
            }),
          }),
        }));
        return;
      }

      if (event.type === 'reply-error') {
        clearTypewriterQueue(event.conversationId, event.messageId);
        patchStreamingMessage(event.conversationId, event.messageId, (message) => ({
          ...message,
          status: 'error',
          metadata: mergeMessageMetadata(message, {
            streamingState: 'error',
            streamingLocal: true,
            errorMessage: event.error,
            aiTrace: buildAiTrace(event, {
              errorMessage: event.error,
            }),
          }),
        }));
      }
    });
  }, [bridge, buildAiTrace, clearTypewriterQueue, completeTypewriterMessage, enqueueTypewriterDelta, ensureStreamingPlaceholder, mergeMessageMetadata, patchStreamingMessage, storeStreamingMessage]);

  useEffect(() => {
    if (!bridge) return undefined;

    return bridge.ai.onMachineRunStream((event) => {
      if (!event || typeof event !== 'object') return;

      if (event.type === 'run-start') {
        storeStreamingMessage(event.conversationId, ensureStreamingPlaceholder({
          ...event.message,
          status: 'streaming',
          metadata: mergeMessageMetadata(event.message, {
            streamingState: 'streaming',
            streamingLocal: true,
            aiTrace: buildAiTrace(event),
          }),
        }));
        return;
      }

      if (event.type === 'run-delta') {
        patchStreamingMessage(event.conversationId, event.messageId, (message) => ({
          ...message,
          metadata: mergeMessageMetadata(message, {
            aiTrace: buildAiTrace(event, {
              model: event.model || '',
            }),
          }),
        }));
        enqueueTypewriterDelta(event);
        return;
      }

      if (event.type === 'run-complete') {
        completeTypewriterMessage(event);
        patchStreamingMessage(event.conversationId, event.messageId, (message) => ({
          ...message,
          metadata: mergeMessageMetadata(message, {
            aiTrace: buildAiTrace(event, {
              model: event.model || '',
            }),
          }),
        }));
        return;
      }

      if (event.type === 'run-error') {
        clearTypewriterQueue(event.conversationId, event.messageId);
        patchStreamingMessage(event.conversationId, event.messageId, (message) => ({
          ...message,
          status: 'error',
          metadata: mergeMessageMetadata(message, {
            streamingState: 'error',
            streamingLocal: true,
            errorMessage: event.error,
            aiTrace: buildAiTrace(event, {
              errorMessage: event.error,
            }),
          }),
        }));
        return;
      }

      if (event.type === 'run-requires-action') {
        patchStreamingMessage(event.conversationId, event.messageId, (message) => ({
          ...message,
          metadata: mergeMessageMetadata(message, {
            aiTrace: buildAiTrace(event, {
              requestReason: event.reason,
              requestMethod: event.requestMethod || '',
            }),
          }),
        }));
      }
    });
  }, [bridge, buildAiTrace, clearTypewriterQueue, completeTypewriterMessage, enqueueTypewriterDelta, ensureStreamingPlaceholder, mergeMessageMetadata, patchStreamingMessage, storeStreamingMessage]);

  const mergeStreamingRecord = useCallback((record: ChatRecord) => {
    return mergeStreamingMessages(record, streamingMessagesRef.current.get(record.chatId));
  }, []);

  return {
    clearConversationStreamingState,
    mergeStreamingRecord,
  };
}
