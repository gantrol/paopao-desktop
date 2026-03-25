import { assertDesktopBridge } from "@/shared/lib/desktop-bridge";

export async function uploadFile(file: File): Promise<string> {
  const uploaded = await assertDesktopBridge().assets.importFile({
    name: file.name,
    type: file.type,
    size: file.size,
    buffer: await file.arrayBuffer(),
  });
  return uploaded.url;
}

export async function uploadFiles(files: File[]): Promise<
  Array<{
    assetId: string;
    url: string;
    originalName: string;
    sizeBytes: number;
    mimeType: string;
    kind: "image" | "video" | "audio" | "file";
  }>
> {
  return assertDesktopBridge().assets.importFiles(
    await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        buffer: await file.arrayBuffer(),
      })),
    ),
  );
}
