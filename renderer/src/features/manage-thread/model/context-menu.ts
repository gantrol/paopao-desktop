import {
  findMessageBlock,
  getMessageBlocks,
  getMessageTextContent,
  type MessageData,
} from '@/entities/message';
import type { ContextMenuState } from '@/shared/model';

function resolveMediaType(block: ReturnType<typeof findMessageBlock> | null): ContextMenuState['mediaType'] {
  if (!block) return null;
  if (block.type === 'image') return 'img';
  if (block.type === 'video') return 'video';
  if (block.type === 'audio') return 'audio';
  if (block.type === 'link') return 'link';
  if (block.type === 'file') return 'file';
  return null;
}

export function extractContextMenuData(
  msg: MessageData,
  blockId?: string,
  subIndex?: number,
): Omit<ContextMenuState, 'show' | 'x' | 'y' | 'msgId'> {
  const blocks = getMessageBlocks(msg);
  const targetBlock = blockId
    ? findMessageBlock(msg, blockId)
    : (typeof subIndex === 'number' ? blocks[subIndex] || null : null);
  const focusBlock = targetBlock || blocks[0] || null;

  return {
    blockId: focusBlock?.id,
    subItemIndex: typeof subIndex === 'number' ? subIndex : undefined,
    content: focusBlock?.type === 'text' ? (focusBlock.text || '') : (getMessageTextContent(msg) || null),
    media: focusBlock?.type === 'file'
      ? (focusBlock.fileName || focusBlock.url || null)
      : (focusBlock?.url || null),
    mediaType: resolveMediaType(focusBlock),
  };
}
