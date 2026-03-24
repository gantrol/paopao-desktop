import {
  createQuoteBubbleBlock,
  createMediaBubbleBlock,
  createTextBubbleBlock,
  getMessageBlocks,
  normalizeBubbleBlocks,
  type BubbleBlock,
  type BubbleDraftSource,
  type MessageData,
} from '@/entities/message';
import type { CompoundEditorItem, DraftState } from './draft';

export function draftItemToBubbleBlock(item: CompoundEditorItem): BubbleBlock | null {
  if (item.type === 'text') {
    return {
      id: item.id || crypto.randomUUID(),
      type: 'text',
      text: item.val || '',
    };
  }

  if (item.type === 'img') {
    return createMediaBubbleBlock('image', item.val || '', { fileName: item.fileName });
  }

  if (item.type === 'video' || item.type === 'audio' || item.type === 'file' || item.type === 'link') {
    return createMediaBubbleBlock(item.type, item.val || '', { fileName: item.fileName });
  }

  return null;
}

export function bubbleBlockToDraftItem(block: BubbleBlock): CompoundEditorItem | null {
  if (block.type === 'text') {
    return {
      id: block.id || crypto.randomUUID(),
      type: 'text',
      val: block.text || '',
    };
  }

  if (block.type === 'image') {
    return {
      id: block.id || crypto.randomUUID(),
      type: 'img',
      val: block.url || '',
      fileName: block.fileName,
    };
  }

  if (block.type === 'video' || block.type === 'audio' || block.type === 'file' || block.type === 'link') {
    return {
      id: block.id || crypto.randomUUID(),
      type: block.type,
      val: block.url || '',
      fileName: block.fileName,
    };
  }

  return null;
}

function normalizeDraftBlockSet(blocks: BubbleBlock[] | null | undefined) {
  return normalizeBubbleBlocks(blocks).filter((block) => block.type !== 'quote');
}

function trimBlockUrl(block: BubbleBlock) {
  return typeof block.url === 'string' ? block.url.trim() : '';
}

function buildDraftSource(block: BubbleBlock): BubbleDraftSource | null {
  if (block.type !== 'quote' || !block.quote?.targetMessageId) return null;
  return {
    relationKind: block.quote.relationKind,
    targetMessageId: block.quote.targetMessageId,
    targetBlockId: block.quote.targetBlockId,
    snapshotBlocks: normalizeBubbleBlocks(block.quote.snapshotBlocks || []),
  };
}

export function getDraftBlocks(
  draft: DraftState | null | undefined,
  options?: { includePlaceholder?: boolean },
) {
  const directBlocks = normalizeDraftBlockSet(Array.isArray(draft?.blocks) ? draft.blocks : null);
  if (directBlocks.length > 0) return directBlocks;

  const legacyBlocks = Array.isArray(draft?.items)
    ? draft.items
      .map((item) => draftItemToBubbleBlock(item))
      .filter((item): item is BubbleBlock => Boolean(item))
    : [];
  if (legacyBlocks.length > 0) return legacyBlocks;

  const draftText = typeof draft?.text === 'string' ? draft.text : '';
  if (draftText) {
    return [createTextBubbleBlock(draftText)];
  }

  return options?.includePlaceholder ? [createTextBubbleBlock('')] : [];
}

export function getDraftMessageBlocks(draft: DraftState | null | undefined) {
  const blocks = sanitizeDraftBlocks(getDraftBlocks(draft));
  const sourceBlocks: BubbleBlock[] = [];
  if (draft?.forwardSource?.targetMessageId) {
    sourceBlocks.push(createQuoteBubbleBlock(draft.forwardSource));
  }
  if (draft?.quoteSource?.targetMessageId) {
    sourceBlocks.push(createQuoteBubbleBlock(draft.quoteSource));
  }
  return normalizeBubbleBlocks([...sourceBlocks, ...blocks]);
}

export function sanitizeDraftBlocks(blocks: BubbleBlock[] | null | undefined) {
  return normalizeDraftBlockSet(blocks)
    .map((block) => {
      if (block.type === 'text') {
        return {
          ...block,
          text: typeof block.text === 'string' ? block.text : '',
        };
      }
      if (block.type === 'link') {
        return {
          ...block,
          url: trimBlockUrl(block),
        };
      }
      if (block.type === 'file') {
        return {
          ...block,
          url: trimBlockUrl(block),
          fileName: typeof block.fileName === 'string' && block.fileName.trim()
            ? block.fileName.trim()
            : undefined,
        };
      }
      if (block.type === 'image' || block.type === 'video' || block.type === 'audio') {
        return {
          ...block,
          url: typeof block.url === 'string' ? block.url : '',
        };
      }
      return block;
    })
    .filter((block) => {
      if (block.type === 'text') return Boolean(block.text?.trim());
      if (block.type === 'file') return Boolean(block.url || block.fileName);
      if (block.type === 'link') return Boolean(block.url);
      if (block.type === 'image' || block.type === 'video' || block.type === 'audio') return Boolean(block.url);
      return false;
    });
}

export function hasDraftContent(draft: DraftState | null | undefined) {
  if (!draft) return false;
  if (sanitizeDraftBlocks(getDraftBlocks(draft)).length > 0) return true;
  return Boolean(draft.quoteSource?.targetMessageId || draft.forwardSource?.targetMessageId);
}

export function updateDraftBlocks(draft: DraftState, blocks: BubbleBlock[]) {
  return {
    ...draft,
    blocks,
    text: '',
    items: [],
  };
}

export function setDraftPrimaryText(blocks: BubbleBlock[], nextText: string) {
  const nextBlocks = normalizeDraftBlockSet(blocks).map((block) => ({ ...block }));
  const firstTextIndex = nextBlocks.findIndex((block) => block.type === 'text');

  if (firstTextIndex >= 0) {
    nextBlocks[firstTextIndex] = {
      ...nextBlocks[firstTextIndex],
      text: nextText,
    };
    return nextBlocks;
  }

  if (!nextText) return nextBlocks;
  return [createTextBubbleBlock(nextText), ...nextBlocks];
}

export function buildDraftStateFromMessage(message: MessageData): DraftState {
  return buildDraftStateFromBlocks(getMessageBlocks(message));
}

export function buildDraftStateFromBlocks(blocksInput: BubbleBlock[] | null | undefined): DraftState {
  let quoteSource: BubbleDraftSource | undefined;
  let forwardSource: BubbleDraftSource | undefined;

  const editableBlocks = normalizeBubbleBlocks(blocksInput).reduce<BubbleBlock[]>((result, block) => {
    if (block.type === 'quote') {
      const source = buildDraftSource(block);
      if (source?.relationKind === 'forward' && !forwardSource) {
        forwardSource = source;
      } else if (source?.relationKind === 'quote' && !quoteSource) {
        quoteSource = source;
      }
      return result;
    }

    result.push({ ...block });
    return result;
  }, []);

  return {
    text: '',
    items: [],
    blocks: editableBlocks.length > 0 ? editableBlocks : [createTextBubbleBlock('')],
    quoteSource,
    forwardSource,
  };
}
