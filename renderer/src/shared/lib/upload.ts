import { assertDesktopBridge } from '@/shared/lib/desktop-bridge';

function assertPersistedAssetUrl(url: string) {
  if (typeof url !== 'string' || !url.startsWith('paopao-asset://')) {
    throw new Error(`Expected a persisted desktop asset URL, received: ${url || '<empty>'}`);
  }
  return url;
}

export async function uploadFile(file: File): Promise<string> {
  const uploaded = await assertDesktopBridge().assets.importFile({
    name: file.name,
    type: file.type,
    size: file.size,
    buffer: await file.arrayBuffer(),
  });
  return assertPersistedAssetUrl(uploaded.url);
}

export async function uploadFiles(files: File[]): Promise<Array<{
  assetId: string;
  url: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  kind: 'image' | 'video' | 'audio' | 'file';
}>> {
  const uploads = await assertDesktopBridge().assets.importFiles(await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      buffer: await file.arrayBuffer(),
    })),
  ));
  return uploads.map((item) => ({
    ...item,
    url: assertPersistedAssetUrl(item.url),
  }));
}
