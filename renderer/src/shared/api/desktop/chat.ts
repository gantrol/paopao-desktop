import type {
  AiProviderRecord,
} from '@/entities/provider';
import type {
  BotConversationRecord,
  BotRecord,
  ConversationBotTriggerResult,
  MachineRunTriggerResult,
} from '@/entities/bot';
import type {
  ChatRecord,
  ChatSummary,
} from '@/entities/conversation';
import type { UserProfileRecord } from '@/entities/user';
import { assertDesktopBridge } from '@/shared/lib/desktop-bridge';

export async function listChats(): Promise<ChatSummary[]> {
  return assertDesktopBridge().conversations.list();
}

export async function getChat(chatId: string): Promise<ChatRecord | null> {
  return assertDesktopBridge().conversations.get(chatId);
}

export async function createChat(payload?: Partial<ChatRecord>): Promise<ChatRecord> {
  return assertDesktopBridge().conversations.create(payload);
}

export async function clearChatMessages(chatId: string): Promise<ChatRecord> {
  return assertDesktopBridge().conversations.clear(chatId);
}

export async function updateChatMeta(payload: Record<string, unknown>): Promise<ChatRecord> {
  return assertDesktopBridge().conversations.updateMeta(payload);
}

export async function saveChat(chat: ChatRecord): Promise<ChatRecord> {
  return assertDesktopBridge().conversations.save(chat);
}

export async function sendChatMessage(payload: Record<string, unknown>): Promise<ChatRecord> {
  return assertDesktopBridge().messages.send(payload);
}

export async function updateChatMessage(payload: Record<string, unknown>): Promise<ChatRecord> {
  return assertDesktopBridge().messages.update(payload);
}

export async function deleteChatMessage(payload: Record<string, unknown>): Promise<ChatRecord> {
  return assertDesktopBridge().messages.delete(payload);
}

export async function buildQuote(payload: Record<string, unknown>): Promise<unknown> {
  return assertDesktopBridge().messages.quote(payload);
}

export async function sendComment(payload: Record<string, unknown>): Promise<ChatRecord> {
  return assertDesktopBridge().messages.comment(payload);
}

export async function toggleLike(payload: Record<string, unknown>): Promise<ChatRecord> {
  return assertDesktopBridge().messages.toggleLike(payload);
}

export async function listBots(payload?: Record<string, unknown>): Promise<BotRecord[]> {
  return assertDesktopBridge().settings.listBots(payload);
}

export async function saveBot(payload: Record<string, unknown>): Promise<string> {
  return assertDesktopBridge().settings.saveBot(payload);
}

export async function getUserProfile(): Promise<UserProfileRecord> {
  return assertDesktopBridge().settings.getUserProfile();
}

export async function saveUserProfile(payload: Record<string, unknown>): Promise<UserProfileRecord> {
  return assertDesktopBridge().settings.saveUserProfile(payload);
}

export async function saveConversationBotBinding(payload: Record<string, unknown>): Promise<BotRecord[]> {
  return assertDesktopBridge().bots.saveBinding(payload);
}

export async function ensureDirectBotConversation(botId: string): Promise<ChatRecord> {
  return assertDesktopBridge().bots.ensureDirectConversation(botId);
}

export async function triggerConversationBots(payload: Record<string, unknown>): Promise<ConversationBotTriggerResult> {
  return assertDesktopBridge().ai.triggerConversationBots(payload);
}

export async function triggerMachineRun(payload: Record<string, unknown>): Promise<MachineRunTriggerResult> {
  return assertDesktopBridge().ai.triggerMachineRun(payload);
}

export async function cancelMachineRun(payload: Record<string, unknown>): Promise<MachineRunTriggerResult> {
  return assertDesktopBridge().ai.cancelMachineRun(payload);
}

export async function listAiProviders(): Promise<AiProviderRecord[]> {
  return assertDesktopBridge().settings.listAiProviders();
}

export async function saveAiProvider(payload: Record<string, unknown>): Promise<string> {
  return assertDesktopBridge().settings.saveAiProvider(payload);
}

export async function listBotConversations(botId: string): Promise<BotConversationRecord[]> {
  return assertDesktopBridge().settings.listBotConversations(botId);
}
