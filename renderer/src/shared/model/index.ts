export interface ImportedAsset {
  assetId: string;
  url: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  kind: 'image' | 'video' | 'audio' | 'file';
}

export interface LinkPreviewMeta {
  title: string;
  description: string;
  image: string;
  siteName: string;
  url: string;
}

export interface ContextMenuState {
  show: boolean;
  x: number;
  y: number;
  conversationId: string | null;
  origin: 'chat' | 'sorting';
  pane: 'stream' | 'thread';
  msgId: string | null;
  blockId?: string;
  subItemIndex?: number;
  content: string | null;
  media: string | null;
  mediaType: 'img' | 'video' | 'audio' | 'link' | 'file' | null;
}
