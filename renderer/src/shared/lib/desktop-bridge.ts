import type { AiProviderRecord } from "@/entities/provider";
import type {
  BotConversationRecord,
  BotRecord,
  ConversationBotStreamEvent,
  ConversationBotTriggerResult,
  MachineRunStreamEvent,
  MachineRunTriggerResult,
} from "@/entities/bot";
import type { ChatRecord, ChatSummary } from "@/entities/conversation";
import type { SortingWorkspaceView } from "@/entities/sorting";
import type { UserProfileRecord } from "@/entities/user";
import type { ImportedAsset, LinkPreviewMeta } from "@/shared/model";

export interface DesktopBridge {
  environment: {
    runtime: "desktop" | "web";
  };
  conversations: {
    list: () => Promise<ChatSummary[]>;
    get: (conversationId: string) => Promise<ChatRecord | null>;
    save: (payload: ChatRecord) => Promise<ChatRecord>;
    create: (payload?: Partial<ChatRecord>) => Promise<ChatRecord>;
    clear: (conversationId: string) => Promise<ChatRecord>;
    updateMeta: (payload: Record<string, unknown>) => Promise<ChatRecord>;
  };
  messages: {
    send: (payload: Record<string, unknown>) => Promise<ChatRecord>;
    update: (payload: Record<string, unknown>) => Promise<ChatRecord>;
    delete: (payload: Record<string, unknown>) => Promise<ChatRecord>;
    quote: (payload: Record<string, unknown>) => Promise<unknown>;
    comment: (payload: Record<string, unknown>) => Promise<ChatRecord>;
    toggleLike: (payload: Record<string, unknown>) => Promise<ChatRecord>;
  };
  assets: {
    importFile: (payload: {
      name: string;
      type: string;
      size: number;
      buffer: ArrayBuffer;
    }) => Promise<ImportedAsset>;
    importFiles: (
      payload: Array<{
        name: string;
        type: string;
        size: number;
        buffer: ArrayBuffer;
      }>,
    ) => Promise<ImportedAsset[]>;
    open: (target: string) => Promise<{ ok: true }>;
  };
  sorting: {
    get: () => Promise<SortingWorkspaceView>;
    save: (payload: Record<string, unknown>) => Promise<SortingWorkspaceView>;
    move: (payload: Record<string, unknown>) => Promise<SortingWorkspaceView>;
    update: (payload: Record<string, unknown>) => Promise<SortingWorkspaceView>;
  };
  linkPreview: {
    get: (url: string) => Promise<LinkPreviewMeta>;
  };
  ai: {
    refine: (payload: Record<string, unknown>) => Promise<unknown>;
    filter: (payload: Record<string, unknown>) => Promise<unknown>;
    triggerConversationBots: (
      payload: Record<string, unknown>,
    ) => Promise<ConversationBotTriggerResult>;
    triggerMachineRun: (
      payload: Record<string, unknown>,
    ) => Promise<MachineRunTriggerResult>;
    cancelMachineRun: (
      payload: Record<string, unknown>,
    ) => Promise<MachineRunTriggerResult>;
    onConversationBotStream: (
      listener: (payload: ConversationBotStreamEvent) => void,
    ) => () => void;
    onMachineRunStream: (
      listener: (payload: MachineRunStreamEvent) => void,
    ) => () => void;
  };
  settings: {
    listAiProviders: () => Promise<AiProviderRecord[]>;
    saveAiProvider: (payload: Record<string, unknown>) => Promise<string>;
    listBots: (payload?: Record<string, unknown>) => Promise<BotRecord[]>;
    listBotConversations: (botId: string) => Promise<BotConversationRecord[]>;
    saveBot: (payload: Record<string, unknown>) => Promise<string>;
    getUserProfile: () => Promise<UserProfileRecord>;
    saveUserProfile: (
      payload: Record<string, unknown>,
    ) => Promise<UserProfileRecord>;
  };
  bots: {
    ensureDirectConversation: (botId: string) => Promise<ChatRecord>;
    saveBinding: (payload: Record<string, unknown>) => Promise<BotRecord[]>;
  };
  system: {
    getInfo: () => Promise<{
      runtime: "desktop" | "web";
      dataRoot?: string;
      dbPath?: string;
      cwd?: string;
    }>;
    exportData: () => Promise<Record<string, unknown>>;
    importData?: (payload: Record<string, unknown>) => Promise<{ ok: true }>;
  };
}

declare global {
  interface Window {
    paopao?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.paopao ?? null;
}

export function assertDesktopBridge(): DesktopBridge {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error(
      "PaoPao desktop bridge is unavailable. Launch the renderer through Electron.",
    );
  }
  return bridge;
}
