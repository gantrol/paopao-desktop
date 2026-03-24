const crypto = require('node:crypto');
const {
  buildRefineMessages,
  normalizeRefineResponse,
  buildFilterMessages,
  normalizeFilterResponse,
  buildBotReplyMessages,
  buildCommentMessages,
  buildExternalAgentTask,
} = require('./promptBuilders');
const { CodexAdapter } = require('./codexAdapter');

const DEFAULT_BASE_URL = process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1';
const DEFAULT_MODEL = process.env.KIMI_MODEL || 'kimi-k2.5';
const BOT_TRANSCRIPT_WINDOW = 18;

function normalizeBaseUrl(url) {
  return typeof url === 'string' ? url.replace(/\/+$/, '') : '';
}

function extractMessageContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        if (typeof block.text === 'string') return block.text;
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function extractReasoningContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        if (typeof block.reasoning_content === 'string') return block.reasoning_content;
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function extractChoiceOutput(choice) {
  const content = extractMessageContent(choice?.message?.content);
  if (content) return content;
  return extractReasoningContent(choice?.message?.reasoning_content);
}

function extractDeltaText(delta) {
  if (!delta || typeof delta !== 'object') return '';

  if (typeof delta.content === 'string') {
    return delta.content;
  }

  if (Array.isArray(delta.content)) {
    return delta.content
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        if (typeof item.text === 'string') return item.text;
        if (typeof item.content === 'string') return item.content;
        if (item.type === 'output_text' && typeof item.text === 'string') return item.text;
        return '';
      })
      .join('');
  }

  if (typeof delta.text === 'string') {
    return delta.text;
  }

  return '';
}

async function safeReadBody(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function clampTemperature(value, fallback = 0.6) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(1.2, Math.max(0, value));
}

function isKimiK25Model(model) {
  return typeof model === 'string' && model.trim().toLowerCase() === 'kimi-k2.5';
}

function normalizeTemperatureForModel(model, value, fallback = 0.6) {
  if (isKimiK25Model(model)) {
    return 1;
  }
  return clampTemperature(value, fallback);
}

async function createChatCompletion({
  apiKey,
  baseUrl,
  model,
  messages,
  temperature = 0.6,
  timeoutMs = 45000,
  responseFormat = null,
}) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const normalizedTemperature = normalizeTemperatureForModel(model, temperature, 0.6);
    const payload = {
      model,
      messages,
      temperature: normalizedTemperature,
    };

    if (responseFormat) {
      payload.response_format = responseFormat;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await safeReadBody(response);
      throw new Error(`Model request failed (${response.status}): ${detail || response.statusText}`);
    }

    const data = await response.json();
    const choice = data?.choices?.[0];
    const content = extractChoiceOutput(choice);

    if (!content) {
      throw new Error('Empty model output.');
    }

    return {
      content,
      usage: data?.usage || null,
      rawModel: data?.model || model,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function streamChatCompletion({
  apiKey,
  baseUrl,
  model,
  messages,
  temperature = 0.6,
  timeoutMs = 90000,
  onTextDelta,
}) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const decoder = new TextDecoder();

  let response = null;
  let usage = null;
  let rawModel = model;
  let content = '';
  let pending = '';
  let doneReceived = false;

  const flushEventBlock = (block) => {
    const lines = block.split(/\r?\n/);
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();

    if (!data) return;
    if (data === '[DONE]') {
      doneReceived = true;
      return;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (typeof parsed?.model === 'string' && parsed.model.trim()) {
      rawModel = parsed.model.trim();
    }

    if (parsed?.usage) {
      usage = parsed.usage;
    }

    const delta = extractDeltaText(parsed?.choices?.[0]?.delta);
    if (!delta) return;

    content += delta;
    onTextDelta?.(delta, content, {
      rawModel,
      usage,
    });
  };

  try {
    const normalizedTemperature = normalizeTemperatureForModel(model, temperature, 0.6);
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: normalizedTemperature,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await safeReadBody(response);
      throw new Error(`Model request failed (${response.status}): ${detail || response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Model stream is unavailable.');
    }

    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      let dividerIndex = pending.search(/\r?\n\r?\n/);
      while (dividerIndex >= 0) {
        const block = pending.slice(0, dividerIndex);
        const separatorLength = pending[dividerIndex] === '\r' ? 4 : 2;
        pending = pending.slice(dividerIndex + separatorLength);
        flushEventBlock(block);
        dividerIndex = pending.search(/\r?\n\r?\n/);
      }
    }

    pending += decoder.decode();
    if (pending.trim()) {
      flushEventBlock(pending);
    }

    if (!content && !doneReceived) {
      throw new Error('Empty model output.');
    }

    return {
      content,
      usage,
      rawModel,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseModelOptions(body) {
  const apiKey = body.apiKey || process.env.KIMI_API_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim()
    ? body.baseUrl.trim()
    : DEFAULT_BASE_URL;
  const model = typeof body.model === 'string' && body.model.trim()
    ? body.model.trim()
    : DEFAULT_MODEL;
  const temperature = normalizeTemperatureForModel(model, body.temperature, 0.6);

  return {
    apiKey,
    baseUrl,
    model,
    temperature,
  };
}

function sanitizeSource(source) {
  if (!source || typeof source !== 'object') return null;
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  const text = typeof source.text === 'string' ? source.text.trim() : '';
  if (!id || !text) return null;
  return {
    id,
    kind: typeof source.kind === 'string' ? source.kind : 'text',
    streamId: typeof source.streamId === 'string' ? source.streamId : '',
    streamTitle: typeof source.streamTitle === 'string' ? source.streamTitle : '',
    time: typeof source.time === 'number' ? source.time : null,
    popped: Boolean(source.popped),
    text,
  };
}

function formatMessageContent(content, type) {
  if (type === 'text' && typeof content === 'string') {
    return content.trim();
  }

  if (type === 'img') return '[图片]';
  if (type === 'video') return '[视频]';
  if (type === 'audio') return '[音频]';
  if (type === 'link' && typeof content === 'string') return `[链接] ${content}`;
  if (type === 'file' && content && typeof content === 'object') {
    return `[文件] ${content.name || '未命名文件'}`;
  }

  if (Array.isArray(content)) {
    return content.map((item) => {
      if (!item || typeof item !== 'object') return '';
      if (item.type === 'text') return item.val || '';
      if (item.type === 'img') return '[图片]';
      if (item.type === 'video') return '[视频]';
      if (item.type === 'audio') return '[音频]';
      if (item.type === 'link') return `[链接] ${item.val || ''}`;
      if (item.type === 'file') return `[文件] ${item.fileName || item.val || '未命名文件'}`;
      return item.val || '';
    }).filter(Boolean).join(' ');
  }

  if (typeof content === 'string') {
    return content.trim();
  }

  return '';
}

function getMessageSpeaker(message) {
  if (message?.role === 'me') return '用户';
  if (typeof message?.senderName === 'string' && message.senderName.trim()) {
    return message.senderName.trim();
  }
  return '助手';
}

function buildConversationTranscript(messages) {
  return messages
    .slice(-BOT_TRANSCRIPT_WINDOW)
    .map((message) => {
      const text = formatMessageContent(message?.content, message?.type);
      if (!text) return null;
      return `${getMessageSpeaker(message)}：${text}`;
    })
    .filter(Boolean)
    .join('\n');
}

function resolveConversationContext(metadata) {
  const raw = metadata && typeof metadata === 'object' ? metadata : {};
  return {
    activeTopicId: typeof raw.activeTopicId === 'string' && raw.activeTopicId.trim() ? raw.activeTopicId.trim() : '',
    activeIdentityId: typeof raw.activeIdentityId === 'string' && raw.activeIdentityId.trim() ? raw.activeIdentityId.trim() : '',
  };
}

function sliceMessagesForTopic(messages, startAfterMessageId) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const normalizedStartAfterMessageId = typeof startAfterMessageId === 'string' ? startAfterMessageId.trim() : '';
  if (!normalizedStartAfterMessageId) {
    return [...messages];
  }

  const startIndex = messages.findIndex((message) => message?.id === normalizedStartAfterMessageId);
  if (startIndex < 0) {
    return [...messages];
  }
  return messages.slice(startIndex + 1);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeReplyText(text, botName) {
  if (typeof text !== 'string') return '';
  const normalized = text
    .replace(new RegExp(`^${escapeRegExp(botName)}[：:]\\s*`), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized;
}

function resolveBotTemperature(bot) {
  const effectiveModel = bot?.model || bot?.providerDefaultModel || DEFAULT_MODEL;
  if (isKimiK25Model(effectiveModel)) {
    return 1;
  }
  const custom = bot?.metadata && typeof bot.metadata === 'object' ? bot.metadata.temperature : undefined;
  if (typeof custom === 'number') {
    return clampTemperature(custom, 0.8);
  }
  if (bot?.metadata?.tone === 'delicate') return 0.72;
  return 0.84;
}

function normalizeScopedBotConfig(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const systemPrompt = typeof raw.systemPrompt === 'string' ? raw.systemPrompt.trim() : '';
  const workspacePath = typeof raw.workspacePath === 'string' ? raw.workspacePath.trim() : '';
  return {
    systemPrompt,
    workspacePath,
  };
}

function getScopedBotConfig(bot) {
  const bindingMetadata = bot?.binding?.metadata && typeof bot.binding.metadata === 'object'
    ? bot.binding.metadata
    : {};
  return normalizeScopedBotConfig(bindingMetadata.scopedConfig);
}

function resolveEffectiveBotSystemPrompt(bot) {
  const scopedConfig = getScopedBotConfig(bot);
  if (scopedConfig.systemPrompt) {
    return scopedConfig.systemPrompt;
  }
  return typeof bot?.systemPrompt === 'string' ? bot.systemPrompt : '';
}

function resolveEffectiveBotRuntimeConfig(bot) {
  const runtimeConfig = bot?.runtimeConfig && typeof bot.runtimeConfig === 'object'
    ? { ...bot.runtimeConfig }
    : {};
  const scopedConfig = getScopedBotConfig(bot);
  if (scopedConfig.workspacePath) {
    runtimeConfig.workspacePath = scopedConfig.workspacePath;
  }
  return runtimeConfig;
}

function resolveEffectiveWorkspacePath(bot, workspacePath = '') {
  const explicitWorkspacePath = typeof workspacePath === 'string' ? workspacePath.trim() : '';
  if (explicitWorkspacePath) return explicitWorkspacePath;
  const runtimeConfig = resolveEffectiveBotRuntimeConfig(bot);
  if (typeof runtimeConfig.workspacePath === 'string' && runtimeConfig.workspacePath.trim()) {
    return runtimeConfig.workspacePath.trim();
  }
  return process.cwd();
}

function resolveBotApiKey(bot, store) {
  const resolvedApiKey = typeof bot?.providerApiKeyRef === 'string' && bot.providerApiKeyRef.trim()
    ? store?.resolveApiKeyRef(bot.providerApiKeyRef.trim())
    : '';
  if (resolvedApiKey) {
    return resolvedApiKey;
  }

  const preset = bot?.providerMetadata && typeof bot.providerMetadata === 'object'
    ? bot.providerMetadata.preset
    : '';

  if (preset === 'deepseek') {
    return process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';
  }
  if (preset === 'kimi') {
    return process.env.KIMI_API_KEY || process.env.OPENAI_API_KEY || '';
  }

  return process.env.OPENAI_API_KEY || '';
}

function extractMentionTokens(bot) {
  return [
    bot.binding?.alias,
    bot.name,
    bot.slug,
  ]
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isBotMentioned(bot, latestUserMessage) {
  if (!latestUserMessage) return false;
  const text = String(latestUserMessage);
  return extractMentionTokens(bot).some((token) => {
    const pattern = new RegExp(`[@＠]\\s*${escapeRegExp(token)}`, /[A-Za-z0-9_-]/.test(token) ? 'i' : undefined);
    return pattern.test(text);
  });
}

function buildBotReplyMessage({ bot, triggerMessageId, content, status = 'success' }) {
  return {
    id: crypto.randomUUID(),
    role: 'ai',
    type: 'text',
    content,
    time: Date.now(),
    status,
    senderId: bot.id,
    senderName: bot.binding?.alias || bot.name,
    senderAvatarUrl: bot.avatarUrl || undefined,
    senderAvatarPreset: bot.avatarPreset || undefined,
    metadata: {
      senderType: 'bot',
      botReply: {
        triggerMessageId,
        botId: bot.id,
      },
    },
  };
}

function findMessageIndex(messages, messageId) {
  return Array.isArray(messages)
    ? messages.findIndex((message) => message?.id === messageId)
    : -1;
}

function isReplyForTrigger(message, triggerMessageId) {
  if (!message || typeof message !== 'object') return false;
  const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : null;
  const botReply = metadata?.botReply && typeof metadata.botReply === 'object' ? metadata.botReply : null;
  return botReply?.triggerMessageId === triggerMessageId;
}

function getReplyBotId(message) {
  if (!message || typeof message !== 'object') return '';
  const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : null;
  const botReply = metadata?.botReply && typeof metadata.botReply === 'object' ? metadata.botReply : null;
  return typeof botReply?.botId === 'string' ? botReply.botId : '';
}

function findInsertionIndex(messages, triggerMessageId) {
  const triggerIndex = findMessageIndex(messages, triggerMessageId);
  if (triggerIndex < 0) return -1;

  let insertionIndex = triggerIndex + 1;
  while (insertionIndex < messages.length && isReplyForTrigger(messages[insertionIndex], triggerMessageId)) {
    insertionIndex += 1;
  }

  return insertionIndex;
}

function stampRepliesForInsertion(replies, messages, insertionIndex) {
  const previousTime = typeof messages[insertionIndex - 1]?.time === 'number'
    ? messages[insertionIndex - 1].time
    : Date.now();
  const nextTime = typeof messages[insertionIndex]?.time === 'number'
    ? messages[insertionIndex].time
    : null;

  if (typeof nextTime === 'number' && nextTime > previousTime) {
    const step = Math.max(1, Math.floor((nextTime - previousTime) / (replies.length + 1)));
    return replies.map((reply, index) => ({
      ...reply,
      time: previousTime + step * (index + 1),
    }));
  }

  const baseTime = Math.max(previousTime + 1, Date.now());
  return replies.map((reply, index) => ({
    ...reply,
    time: baseTime + index,
  }));
}

function shouldDisplayBotTriggerResult(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.status === 'error') return true;
  if (item.status !== 'skipped') return false;
  return item.reason !== '未被 @，本次不回复' && item.reason !== '该消息已有 bot 回复';
}

function collectBotTriggerStatusItems(results) {
  return Array.isArray(results)
    ? results.filter(shouldDisplayBotTriggerResult)
    : [];
}

function getMachineRunMetadata(message) {
  if (!message || typeof message !== 'object') return null;
  const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : null;
  const machineRun = metadata?.machineRun && typeof metadata.machineRun === 'object' ? metadata.machineRun : null;
  return machineRun;
}

function isMachineCommentMatch(message, {
  sourceMessageId,
  targetBlockId,
  botId,
  outputMode,
}) {
  const machineRun = getMachineRunMetadata(message);
  if (!machineRun) return false;
  return machineRun.sourceMessageId === sourceMessageId
    && machineRun.botId === botId
    && machineRun.outputMode === outputMode
    && (machineRun.targetBlockId || '') === (targetBlockId || '');
}

function buildMachineCommentMessage({
  bot,
  runId,
  sourceMessageId,
  targetBlockId,
  runtimeType,
  outputMode = 'thread-comment',
  content = '',
  status = 'streaming',
  messageId = crypto.randomUUID(),
}) {
  return {
    id: messageId,
    role: 'ai',
    type: 'text',
    content,
    time: Date.now(),
    status,
    senderId: bot.id,
    senderName: bot.binding?.alias || bot.name,
    senderAvatarUrl: bot.avatarUrl || undefined,
    senderAvatarPreset: bot.avatarPreset || undefined,
    replyToMessageId: sourceMessageId,
    commentTarget: {
      messageId: sourceMessageId,
      ...(targetBlockId ? { blockId: targetBlockId } : {}),
    },
    metadata: {
      senderType: 'bot',
      machineRun: {
        runId,
        botId: bot.id,
        runtimeType,
        sourceMessageId,
        targetBlockId: targetBlockId || null,
        outputMode,
      },
    },
  };
}

function buildThreadTranscript(messages, sourceMessageId, targetBlockId) {
  return messages
    .filter((message) => (
      message?.replyToMessageId === sourceMessageId
      && ((message?.commentTarget?.blockId || '') === (targetBlockId || ''))
    ))
    .slice(-10)
    .map((message) => {
      const text = formatMessageContent(message?.content, message?.type);
      if (!text) return null;
      return `${getMessageSpeaker(message)}：${text}`;
    })
    .filter(Boolean)
    .join('\n');
}

function resolveMessageAuthor(message) {
  if (message?.role === 'me') return '用户';
  if (typeof message?.senderName === 'string' && message.senderName.trim()) {
    return message.senderName.trim();
  }
  if (message?.role === 'ai') return '助手';
  return '用户';
}

function resolveMachineModel(bot) {
  if (bot?.runtimeType === 'external-codex') {
    const runtimeConfig = resolveEffectiveBotRuntimeConfig(bot);
    return runtimeConfig?.model || bot?.model || 'codex';
  }
  return bot?.model || bot?.providerDefaultModel || DEFAULT_MODEL;
}

class AiService {
  constructor(store, options = {}) {
    this.store = store;
    this.conversationQueues = new Map();
    this.machineQueues = new Map();
    this.activeMachineRuns = new Map();
    this.codexAdapter = options.codexAdapter instanceof CodexAdapter
      ? options.codexAdapter
      : new CodexAdapter();
    this.emitConversationBotStreamEvent = typeof options.emitConversationBotStreamEvent === 'function'
      ? options.emitConversationBotStreamEvent
      : () => {};
    this.emitMachineRunStreamEvent = typeof options.emitMachineRunStreamEvent === 'function'
      ? options.emitMachineRunStreamEvent
      : () => {};
  }

  async runRefine(body) {
    const sources = Array.isArray(body.sources) ? body.sources.map(sanitizeSource).filter(Boolean) : [];
    if (sources.length === 0) {
      throw new Error('sources is required and must contain text.');
    }

    const { apiKey, baseUrl, model, temperature } = parseModelOptions(body);
    if (!apiKey) {
      throw new Error('Missing apiKey. Provide it in request body or KIMI_API_KEY env.');
    }

    const runId = this.store.createAiRun({
      kind: 'sorting-refine',
      status: 'running',
      model,
      inputRefIds: sources.map((item) => item.id),
      promptText: body.objective || '',
      metadata: {
        baseUrl,
        temperature,
      },
    });

    try {
      const completion = await createChatCompletion({
        apiKey,
        baseUrl,
        model,
        messages: buildRefineMessages({
          sources,
          objective: typeof body.objective === 'string' ? body.objective : '',
          manualDraft: typeof body.manualDraft === 'string' ? body.manualDraft : '',
        }),
        temperature,
        responseFormat: { type: 'json_object' },
      });

      const normalized = normalizeRefineResponse(completion.content, sources);
      this.store.completeAiRun(runId, {
        status: 'done',
        responseText: normalized.refined,
        usage: completion.usage,
      });

      return {
        runId,
        title: normalized.title,
        refined: normalized.refined,
        keyPoints: normalized.keyPoints,
        sourceIds: normalized.sourceIds,
        model: completion.rawModel,
        usage: completion.usage,
      };
    } catch (error) {
      this.store.completeAiRun(runId, {
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown refine error',
      });
      throw error;
    }
  }

  async runFilter(body) {
    const sources = Array.isArray(body.sources) ? body.sources.map(sanitizeSource).filter(Boolean) : [];
    if (sources.length === 0) {
      throw new Error('sources is required and must contain text.');
    }

    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      throw new Error('query is required.');
    }

    const { apiKey, baseUrl, model, temperature } = parseModelOptions(body);
    if (!apiKey) {
      throw new Error('Missing apiKey. Provide it in request body or KIMI_API_KEY env.');
    }

    const runId = this.store.createAiRun({
      kind: 'sorting-filter',
      status: 'running',
      model,
      inputRefIds: sources.map((item) => item.id),
      promptText: query,
      metadata: {
        baseUrl,
        temperature,
      },
    });

    try {
      const completion = await createChatCompletion({
        apiKey,
        baseUrl,
        model,
        messages: buildFilterMessages({ sources, query }),
        temperature,
        responseFormat: { type: 'json_object' },
      });

      const normalized = normalizeFilterResponse(completion.content, sources);
      this.store.completeAiRun(runId, {
        status: 'done',
        responseText: normalized.reason,
      });

      return {
        runId,
        sourceIds: normalized.sourceIds,
        reason: normalized.reason,
        model: completion.rawModel,
      };
    } catch (error) {
      this.store.completeAiRun(runId, {
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown filter error',
      });
      throw error;
    }
  }

  enqueueConversationBots(body) {
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : '';
    const triggerMessageId = typeof body?.triggerMessageId === 'string' ? body.triggerMessageId.trim() : '';
    if (!conversationId) {
      throw new Error('conversationId is required.');
    }
    if (!triggerMessageId) {
      throw new Error('triggerMessageId is required.');
    }

    const previous = this.conversationQueues.get(conversationId) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(() => this.runConversationBots({ conversationId, triggerMessageId }));

    const settledTask = task.finally(() => {
      if (this.conversationQueues.get(conversationId) === settledTask) {
        this.conversationQueues.delete(conversationId);
      }
    });

    this.conversationQueues.set(conversationId, settledTask);
    return settledTask;
  }

  enqueueMachineConversationTask(conversationId, taskFactory) {
    const previous = this.machineQueues.get(conversationId) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(() => taskFactory());

    const settledTask = task.finally(() => {
      if (this.machineQueues.get(conversationId) === settledTask) {
        this.machineQueues.delete(conversationId);
      }
    });

    this.machineQueues.set(conversationId, settledTask);
    return settledTask;
  }

  emitConversationBotStream(payload) {
    try {
      this.emitConversationBotStreamEvent(payload);
    } catch {
      // Renderer listeners are best-effort only.
    }
  }

  emitMachineRunStream(payload) {
    try {
      this.emitMachineRunStreamEvent(payload);
    } catch {
      // Renderer listeners are best-effort only.
    }
  }

  triggerMachineRun(body) {
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : '';
    const sourceMessageId = typeof body?.sourceMessageId === 'string' ? body.sourceMessageId.trim() : '';
    const botId = typeof body?.botId === 'string' ? body.botId.trim() : '';
    const targetBlockId = typeof body?.targetBlockId === 'string' ? body.targetBlockId.trim() : '';

    if (!conversationId) {
      throw new Error('conversationId is required.');
    }
    if (!sourceMessageId) {
      throw new Error('sourceMessageId is required.');
    }

    if (!botId) {
      void this.enqueueMachineConversationTask(
        conversationId,
        () => this.runAutomaticCommentMachines({
          conversationId,
          sourceMessageId,
          targetBlockId,
        }),
      ).catch(() => {});
      return {
        status: 'queued',
        conversationId,
        sourceMessageId,
      };
    }

    return this.scheduleManualMachineRun({
      conversationId,
      sourceMessageId,
      targetBlockId,
      botId,
      prompt: typeof body?.prompt === 'string' ? body.prompt : '',
      workspacePath: typeof body?.workspacePath === 'string' ? body.workspacePath : '',
    });
  }

  async cancelMachineRun(body) {
    const runId = typeof body?.runId === 'string' ? body.runId.trim() : '';
    if (!runId) {
      throw new Error('runId is required.');
    }

    const activeRun = this.activeMachineRuns.get(runId);
    if (!activeRun) {
      return { runId, cancelled: false };
    }

    activeRun.cancelled = true;
    this.activeMachineRuns.delete(runId);

    try {
      await activeRun.cancel();
    } finally {
      this.store.updateAiRun(runId, {
        status: 'cancelled',
        errorMessage: '已取消',
        finishedAt: Date.now(),
      });
      this.emitMachineRunStream({
        type: 'run-error',
        runId,
        conversationId: activeRun.conversationId,
        sourceMessageId: activeRun.sourceMessageId,
        targetBlockId: activeRun.targetBlockId || '',
        botId: activeRun.bot.id,
        botName: activeRun.bot.binding?.alias || activeRun.bot.name,
        runtimeType: activeRun.bot.runtimeType,
        messageId: activeRun.messageId,
        error: '已取消',
      });
    }

    return { runId, cancelled: true };
  }

  getBoundBot(conversationId, botId) {
    return this.store.getConversationBotParticipants(conversationId).find((bot) => bot.id === botId) || null;
  }

  getGlobalBot(botId) {
    return this.store.listBots().find((bot) => bot.id === botId && bot.enabled) || null;
  }

  getMachineRunContext({ conversationId, sourceMessageId, targetBlockId }) {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const sourceMessage = conversation.messages.find((message) => message.id === sourceMessageId) || null;
    if (!sourceMessage) {
      throw new Error(`Message not found: ${sourceMessageId}`);
    }

    const conversationContext = resolveConversationContext(conversation.metadata);
    const activeIdentity = conversationContext.activeIdentityId
      ? this.store.listIdentities().find((identity) => identity.id === conversationContext.activeIdentityId) || null
      : null;
    const activeTopic = conversationContext.activeTopicId
      ? this.store.getConversationTopic(conversationContext.activeTopicId)
      : null;
    const topicMessages = sliceMessagesForTopic(conversation.messages, activeTopic?.startAfterMessageId);
    const triggerIndex = findMessageIndex(topicMessages, sourceMessageId);
    const transcriptMessages = triggerIndex >= 0
      ? topicMessages.slice(0, triggerIndex + 1)
      : topicMessages;

    return {
      conversation,
      sourceMessage,
      targetBlockId,
      activeIdentity,
      activeTopic,
      transcriptMessages,
      transcript: buildConversationTranscript(transcriptMessages),
      threadContext: buildThreadTranscript(conversation.messages, sourceMessageId, targetBlockId),
      sourceAuthor: resolveMessageAuthor(sourceMessage),
      sourceText: formatMessageContent(sourceMessage.content, sourceMessage.type),
    };
  }

  startMachineRunWithError({
    runId,
    conversationId,
    sourceMessageId,
    targetBlockId,
    bot,
    runtimeType,
    messageId,
    error,
  }) {
    this.emitMachineRunStream({
      type: 'run-error',
      runId,
      conversationId,
      sourceMessageId,
      targetBlockId,
      botId: bot.id,
      botName: bot.binding?.alias || bot.name,
      runtimeType,
      messageId,
      error,
    });
    this.store.completeAiRun(runId, {
      status: 'error',
      errorMessage: error,
      outputMessageId: messageId,
    });
    return {
      runId,
      messageId,
      botId: bot.id,
      botName: bot.name,
      status: 'error',
      error,
    };
  }

  async runSingleCommentMachine({
    conversationId,
    sourceMessageId,
    targetBlockId = '',
    bot,
    context,
  }) {
    const runtimeType = bot.runtimeType || 'llm';
    const botName = bot.binding?.alias || bot.name;
    const model = resolveMachineModel(bot);
    const effectiveSystemPrompt = resolveEffectiveBotSystemPrompt(bot);
    const effectiveWorkspacePath = runtimeType === 'external-codex'
      ? resolveEffectiveWorkspacePath(bot)
      : '';

    const existingMessage = context.conversation.messages.find((message) => isMachineCommentMatch(message, {
      sourceMessageId,
      targetBlockId,
      botId: bot.id,
      outputMode: 'thread-comment',
    }));
    if (existingMessage) {
      return {
        runId: '',
        messageId: existingMessage.id,
        botId: bot.id,
        status: 'skipped',
        reason: '该泡泡已有该机器评论',
      };
    }

    const runId = this.store.createAiRun({
      providerId: runtimeType === 'llm' ? (bot.providerId || null) : null,
      kind: 'message-comment',
      status: 'running',
      model,
      conversationId,
      triggerMessageId: sourceMessageId,
      inputRefIds: context.transcriptMessages.map((message) => message.id).filter(Boolean),
      promptText: context.sourceText,
      metadata: {
        botId: bot.id,
        runtimeType,
        sourceMessageId,
        targetBlockId: targetBlockId || null,
        workspacePath: effectiveWorkspacePath || null,
        externalThreadId: null,
        rolloutPath: null,
        outputMode: 'thread-comment',
      },
    });

    const placeholder = buildMachineCommentMessage({
      bot,
      runId,
      sourceMessageId,
      targetBlockId,
      runtimeType,
    });

    this.emitMachineRunStream({
      type: 'run-start',
      runId,
      conversationId,
      sourceMessageId,
      targetBlockId,
      botId: bot.id,
      botName,
      runtimeType,
      message: placeholder,
    });

    try {
      let commentText = '';
      let completionModel = '';
      let usage = null;

      if (runtimeType === 'llm') {
        if (!bot.providerId) {
          return this.startMachineRunWithError({
            runId,
            conversationId,
            sourceMessageId,
            targetBlockId,
            bot,
            runtimeType,
            messageId: placeholder.id,
            error: 'Bot 未配置模型提供方',
          });
        }
        if (!bot.providerEnabled) {
          return this.startMachineRunWithError({
            runId,
            conversationId,
            sourceMessageId,
            targetBlockId,
            bot,
            runtimeType,
            messageId: placeholder.id,
            error: '关联 provider 已禁用',
          });
        }

        const apiKey = resolveBotApiKey(bot, this.store);
        if (!apiKey) {
          return this.startMachineRunWithError({
            runId,
            conversationId,
            sourceMessageId,
            targetBlockId,
            bot,
            runtimeType,
            messageId: placeholder.id,
            error: '缺少 API Key',
          });
        }

        const baseUrl = bot.providerBaseUrl || DEFAULT_BASE_URL;
        let streamedContent = '';
        const completion = await streamChatCompletion({
          apiKey,
          baseUrl,
          model,
          messages: buildCommentMessages({
            botName,
            systemPrompt: effectiveSystemPrompt,
            conversationTitle: context.conversation.title,
            transcript: context.transcript,
            sourceMessage: context.sourceText,
            sourceAuthor: context.sourceAuthor,
            threadContext: context.threadContext,
          }),
          temperature: resolveBotTemperature(bot),
          onTextDelta: (_delta, fullContent, meta) => {
            const normalizedContent = normalizeReplyText(fullContent, bot.name);
            if (!normalizedContent.startsWith(streamedContent)) {
              streamedContent = normalizedContent;
              this.emitMachineRunStream({
                type: 'run-delta',
                runId,
                conversationId,
                sourceMessageId,
                targetBlockId,
                botId: bot.id,
                botName,
                runtimeType,
                messageId: placeholder.id,
                delta: normalizedContent,
                content: normalizedContent,
                model: meta?.rawModel,
              });
              return;
            }
            const delta = normalizedContent.slice(streamedContent.length);
            if (!delta) return;
            streamedContent = normalizedContent;
            this.emitMachineRunStream({
              type: 'run-delta',
              runId,
              conversationId,
              sourceMessageId,
              targetBlockId,
              botId: bot.id,
              botName,
              runtimeType,
              messageId: placeholder.id,
              delta,
              content: normalizedContent,
              model: meta?.rawModel,
            });
          },
        });

        commentText = normalizeReplyText(completion.content, bot.name);
        completionModel = completion.rawModel || '';
        usage = completion.usage || null;
      } else {
        const activeRun = {
          runId,
          bot,
          conversationId,
          sourceMessageId,
          targetBlockId,
          messageId: placeholder.id,
          cancelled: false,
          cancel: async () => {},
        };
        this.activeMachineRuns.set(runId, activeRun);

        try {
          const started = await this.codexAdapter.startRun({
            bot: {
              ...bot,
              runtimeConfig: resolveEffectiveBotRuntimeConfig(bot),
            },
            systemPrompt: effectiveSystemPrompt,
            taskPrompt: buildExternalAgentTask({
              conversationTitle: context.conversation.title,
              sourceMessage: context.sourceText,
              sourceAuthor: context.sourceAuthor,
              threadContext: context.threadContext,
              workspacePath: effectiveWorkspacePath,
              outputMode: 'thread-comment',
            }),
            workspacePath: effectiveWorkspacePath,
            onEvent: (event) => {
              if (activeRun.cancelled) return;
              if (event.type !== 'delta') return;
              this.emitMachineRunStream({
                type: 'run-delta',
                runId,
                conversationId,
                sourceMessageId,
                targetBlockId,
                botId: bot.id,
                botName,
                runtimeType,
                messageId: placeholder.id,
                delta: event.delta || '',
                content: event.content || '',
                model,
              });
            },
          });

          activeRun.cancel = started.cancel;
          this.store.updateAiRun(runId, {
            metadata: {
              workspacePath: started.workspacePath,
              externalThreadId: started.thread?.id || null,
              rolloutPath: started.thread?.path || '',
            },
          });

          const completion = await started.completion;
          if (activeRun.cancelled) {
            return {
              runId,
              messageId: placeholder.id,
              botId: bot.id,
              status: 'cancelled',
            };
          }
          commentText = normalizeReplyText(completion.content, bot.name).trim() || String(completion.content || '').trim();
          completionModel = model;
        } finally {
          this.activeMachineRuns.delete(runId);
        }
      }

      if (!commentText) {
        throw new Error('Empty machine comment.');
      }

      const finalMessage = buildMachineCommentMessage({
        bot,
        runId,
        sourceMessageId,
        targetBlockId,
        runtimeType,
        content: commentText,
        status: 'success',
        messageId: placeholder.id,
      });

      await this.store.commentMessage({
        conversationId,
        messageId: sourceMessageId,
        targetBlockId,
        message: finalMessage,
      });

      this.store.completeAiRun(runId, {
        status: 'done',
        responseText: commentText,
        usage,
        outputMessageId: finalMessage.id,
      });
      this.emitMachineRunStream({
        type: 'run-complete',
        runId,
        conversationId,
        sourceMessageId,
        targetBlockId,
        botId: bot.id,
        botName,
        runtimeType,
        messageId: finalMessage.id,
        content: commentText,
        model: completionModel,
      });

      return {
        runId,
        messageId: finalMessage.id,
        botId: bot.id,
        status: 'done',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown machine comment error';
      this.emitMachineRunStream({
        type: 'run-error',
        runId,
        conversationId,
        sourceMessageId,
        targetBlockId,
        botId: bot.id,
        botName,
        runtimeType,
        messageId: placeholder.id,
        error: message,
      });
      this.store.completeAiRun(runId, {
        status: 'error',
        errorMessage: message,
        outputMessageId: placeholder.id,
      });
      return {
        runId,
        messageId: placeholder.id,
        botId: bot.id,
        status: 'error',
        error: message,
      };
    }
  }

  async runAutomaticCommentMachines({
    conversationId,
    sourceMessageId,
    targetBlockId = '',
  }) {
    const context = this.getMachineRunContext({
      conversationId,
      sourceMessageId,
      targetBlockId,
    });
    if (context.sourceMessage.replyToMessageId) {
      return {
        conversationId,
        sourceMessageId,
        results: [],
      };
    }

    const candidateBots = this.store.getConversationBotParticipants(conversationId, {
      identityId: context.activeIdentity?.id || '',
    }).filter((bot) => (
      (bot.runtimeType === 'llm' || bot.runtimeType === 'external-codex')
      && bot.binding?.outputMode === 'thread-comment'
    ));

    const latestUserMessage = context.sourceText;
    const results = [];
    for (const bot of candidateBots) {
      const triggerMode = bot.binding?.triggerMode || 'auto';
      if (triggerMode === 'manual') {
        results.push({
          botId: bot.id,
          botName: bot.name,
          status: 'skipped',
          reason: '手动触发',
        });
        continue;
      }
      if (triggerMode === 'mention' && !isBotMentioned(bot, latestUserMessage)) {
        results.push({
          botId: bot.id,
          botName: bot.name,
          status: 'skipped',
          reason: '未被 @，本次不评论',
        });
        continue;
      }

      results.push(await this.runSingleCommentMachine({
        conversationId,
        sourceMessageId,
        targetBlockId,
        bot,
        context,
      }));
    }

    return {
      conversationId,
      sourceMessageId,
      results,
    };
  }

  scheduleManualMachineRun({
    conversationId,
    sourceMessageId,
    targetBlockId = '',
    botId,
    prompt = '',
    workspacePath = '',
  }) {
    const bot = this.getBoundBot(conversationId, botId) || this.getGlobalBot(botId);
    if (!bot) {
      throw new Error('该泡泡机不存在，或已被停用。');
    }

    if (bot.runtimeType !== 'external-codex' && bot.runtimeType !== 'llm') {
      throw new Error(`Unsupported machine runtime: ${bot.runtimeType || 'unknown'}`);
    }

    if (bot.runtimeType === 'llm') {
      const context = this.getMachineRunContext({
        conversationId,
        sourceMessageId,
        targetBlockId,
      });
      void this.enqueueMachineConversationTask(
        conversationId,
        () => this.runSingleCommentMachine({
          conversationId,
          sourceMessageId,
          targetBlockId,
          bot,
          context,
        }),
      ).catch(() => {});
      return {
        status: 'queued',
        conversationId,
        sourceMessageId,
        botId,
      };
    }

    const context = this.getMachineRunContext({
      conversationId,
      sourceMessageId,
      targetBlockId,
    });
    const runtimeType = bot.runtimeType;
    const botName = bot.binding?.alias || bot.name;
    const effectiveWorkspacePath = resolveEffectiveWorkspacePath(bot, workspacePath);
    const effectiveSystemPrompt = resolveEffectiveBotSystemPrompt(bot);
    const runId = this.store.createAiRun({
      providerId: null,
      kind: 'external-agent-run',
      status: 'running',
      model: resolveMachineModel(bot),
      conversationId,
      triggerMessageId: sourceMessageId,
      inputRefIds: [sourceMessageId],
      promptText: prompt || context.sourceText,
      metadata: {
        botId: bot.id,
        runtimeType,
        sourceMessageId,
        targetBlockId: targetBlockId || null,
        workspacePath: effectiveWorkspacePath,
        externalThreadId: null,
        rolloutPath: null,
        outputMode: 'thread-comment',
      },
    });

    const placeholder = buildMachineCommentMessage({
      bot,
      runId,
      sourceMessageId,
      targetBlockId,
      runtimeType,
    });

    this.emitMachineRunStream({
      type: 'run-start',
      runId,
      conversationId,
      sourceMessageId,
      targetBlockId,
      botId: bot.id,
      botName,
      runtimeType,
      message: placeholder,
    });

    const activeRun = {
      runId,
      bot,
      conversationId,
      sourceMessageId,
      targetBlockId,
      messageId: placeholder.id,
      cancelled: false,
      cancel: async () => {},
    };
    this.activeMachineRuns.set(runId, activeRun);

    void (async () => {
      try {
        const started = await this.codexAdapter.startRun({
          bot: {
            ...bot,
            runtimeConfig: resolveEffectiveBotRuntimeConfig(bot),
          },
          systemPrompt: effectiveSystemPrompt,
          taskPrompt: buildExternalAgentTask({
            conversationTitle: context.conversation.title,
            sourceMessage: context.sourceText,
            sourceAuthor: context.sourceAuthor,
            threadContext: context.threadContext,
            workspacePath: effectiveWorkspacePath,
            extraPrompt: prompt,
            outputMode: 'thread-comment',
          }),
          workspacePath: effectiveWorkspacePath,
          onEvent: (event) => {
            if (activeRun.cancelled) return;
            if (event.type === 'delta') {
              this.emitMachineRunStream({
                type: 'run-delta',
                runId,
                conversationId,
                sourceMessageId,
                targetBlockId,
                botId: bot.id,
                botName,
                runtimeType,
                messageId: placeholder.id,
                delta: event.delta || '',
                content: event.content || '',
                model: resolveMachineModel(bot),
              });
              return;
            }
            if (event.type === 'requires-action') {
              this.emitMachineRunStream({
                type: 'run-requires-action',
                runId,
                conversationId,
                sourceMessageId,
                targetBlockId,
                botId: bot.id,
                botName,
                runtimeType,
                messageId: placeholder.id,
                reason: event.reason || 'Codex 请求额外操作',
                requestMethod: event.requestMethod || '',
              });
            }
          },
        });

        activeRun.cancel = started.cancel;
        this.store.updateAiRun(runId, {
          metadata: {
            workspacePath: started.workspacePath,
            externalThreadId: started.thread?.id || null,
            rolloutPath: started.thread?.path || '',
          },
        });

        const completion = await started.completion;
        if (activeRun.cancelled) return;

        const finalText = normalizeReplyText(completion.content, bot.name).trim() || String(completion.content || '').trim();
        if (!finalText) {
          throw new Error('Codex 未返回可写入的评论内容。');
        }

        const finalMessage = buildMachineCommentMessage({
          bot,
          runId,
          sourceMessageId,
          targetBlockId,
          runtimeType,
          content: finalText,
          status: 'success',
          messageId: placeholder.id,
        });

        await this.store.commentMessage({
          conversationId,
          messageId: sourceMessageId,
          targetBlockId,
          message: finalMessage,
        });

        this.store.completeAiRun(runId, {
          status: 'done',
          responseText: finalText,
          outputMessageId: finalMessage.id,
        });
        this.emitMachineRunStream({
          type: 'run-complete',
          runId,
          conversationId,
          sourceMessageId,
          targetBlockId,
          botId: bot.id,
          botName,
          runtimeType,
          messageId: finalMessage.id,
          content: finalText,
          model: resolveMachineModel(bot),
        });
      } catch (error) {
        if (activeRun.cancelled) return;
        const message = error instanceof Error ? error.message : 'Unknown external agent error';
        this.store.completeAiRun(runId, {
          status: 'error',
          errorMessage: message,
          outputMessageId: placeholder.id,
        });
        this.emitMachineRunStream({
          type: 'run-error',
          runId,
          conversationId,
          sourceMessageId,
          targetBlockId,
          botId: bot.id,
          botName,
          runtimeType,
          messageId: placeholder.id,
          error: message,
        });
      } finally {
        this.activeMachineRuns.delete(runId);
      }
    })();

    return {
      status: 'started',
      runId,
      messageId: placeholder.id,
      conversationId,
      sourceMessageId,
      botId,
    };
  }

  async runConversationBots({ conversationId, triggerMessageId }) {
    const initialConversation = this.store.getConversation(conversationId);
    if (!initialConversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const conversationContext = resolveConversationContext(initialConversation.metadata);
    const activeIdentity = conversationContext.activeIdentityId
      ? this.store.listIdentities().find((identity) => identity.id === conversationContext.activeIdentityId) || null
      : null;
    const activeTopic = conversationContext.activeTopicId
      ? this.store.getConversationTopic(conversationContext.activeTopicId)
      : null;
    const topicMessages = sliceMessagesForTopic(initialConversation.messages, activeTopic?.startAfterMessageId);
    const boundBots = this.store.getConversationBotParticipants(conversationId, {
      identityId: activeIdentity?.id || '',
    });
    if (boundBots.length === 0) {
      return {
        conversation: initialConversation,
        results: [],
      };
    }

    const triggerIndex = findMessageIndex(topicMessages, triggerMessageId);
    if (triggerIndex < 0) {
      return {
        conversation: initialConversation,
        results: [],
      };
    }

    const transcriptMessages = topicMessages.slice(0, triggerIndex + 1);
    const latestUserMessage = formatMessageContent(
      transcriptMessages[transcriptMessages.length - 1]?.content,
      transcriptMessages[transcriptMessages.length - 1]?.type,
    );
    const transcript = buildConversationTranscript(transcriptMessages);
    const inputRefIds = transcriptMessages.map((message) => message.id).filter(Boolean);
    const repliedBotIds = new Set(
      initialConversation.messages
        .filter((message) => isReplyForTrigger(message, triggerMessageId))
        .map((message) => getReplyBotId(message))
        .filter(Boolean),
    );
    const mentionedBotIds = new Set(
      boundBots
        .filter((bot) => isBotMentioned(bot, latestUserMessage))
        .map((bot) => bot.id),
    );

    const replyMessages = [];
    const results = [];

    for (const bot of boundBots) {
      if (bot.binding?.outputMode !== 'stream-reply') {
        continue;
      }
      if (bot.runtimeType !== 'llm' && bot.runtimeType !== 'external-codex') {
        continue;
      }
      if (repliedBotIds.has(bot.id)) {
        results.push({
          botId: bot.id,
          botName: bot.name,
          status: 'skipped',
          reason: '该消息已有 bot 回复',
        });
        continue;
      }

      const triggerMode = bot.binding?.triggerMode || bot.binding?.replyMode || 'auto';
      if (triggerMode === 'manual') {
        results.push({
          botId: bot.id,
          botName: bot.name,
          status: 'skipped',
          reason: '手动触发',
        });
        continue;
      }

      if (triggerMode === 'mention' && !mentionedBotIds.has(bot.id)) {
        results.push({
          botId: bot.id,
          botName: bot.name,
          status: 'skipped',
          reason: '未被 @，本次不回复',
        });
        continue;
      }

      const runtimeType = bot.runtimeType || 'llm';
      const botName = bot.binding?.alias || bot.name;
      const effectiveSystemPrompt = resolveEffectiveBotSystemPrompt(bot);
      const effectiveWorkspacePath = runtimeType === 'external-codex'
        ? resolveEffectiveWorkspacePath(bot)
        : '';
      const model = resolveMachineModel(bot);

      if (runtimeType === 'llm' && !bot.providerId) {
        results.push({
          botId: bot.id,
          botName: bot.name,
          status: 'skipped',
          reason: 'Bot 未配置模型提供方',
        });
        continue;
      }

      if (runtimeType === 'llm' && !bot.providerEnabled) {
        results.push({
          botId: bot.id,
          botName: bot.name,
          status: 'skipped',
          reason: '关联 provider 已禁用',
        });
        continue;
      }

      if (runtimeType === 'llm' && !resolveBotApiKey(bot, this.store)) {
        results.push({
          botId: bot.id,
          botName: bot.name,
          status: 'skipped',
          reason: '缺少 API Key',
        });
        continue;
      }

      const runId = this.store.createAiRun({
        providerId: runtimeType === 'llm' ? bot.providerId : null,
        kind: 'chat-reply',
        status: 'running',
        model,
        conversationId,
        triggerMessageId,
        inputRefIds,
        promptText: latestUserMessage,
        metadata: {
          botId: bot.id,
          botName: bot.name,
          runtimeType,
          workspacePath: effectiveWorkspacePath || null,
        },
      });
      const replyMessage = buildBotReplyMessage({
        bot,
        triggerMessageId,
        content: '',
        status: 'streaming',
      });

      try {
        this.emitConversationBotStream({
          type: 'reply-start',
          conversationId,
          triggerMessageId,
          botId: bot.id,
          botName,
          message: replyMessage,
        });

        let replyText = '';
        let completionModel = '';
        let usage = null;

        if (runtimeType === 'llm') {
          const apiKey = resolveBotApiKey(bot, this.store);
          const baseUrl = bot.providerBaseUrl || DEFAULT_BASE_URL;
          let streamedContent = '';
          const completion = await streamChatCompletion({
            apiKey,
            baseUrl,
            model,
            messages: buildBotReplyMessages({
              botName,
              systemPrompt: effectiveSystemPrompt,
              conversationTitle: initialConversation.title,
              transcript,
              latestUserMessage,
              identity: activeIdentity,
              relationPrompt: bot.identityBinding?.enabled ? bot.identityBinding.relationPrompt : '',
              topicTitle: activeTopic?.title || '',
              topicSummary: activeTopic?.summary || '',
            }),
            temperature: resolveBotTemperature(bot),
            onTextDelta: (_delta, fullContent, meta) => {
              const normalizedContent = normalizeReplyText(fullContent, bot.name);
              if (!normalizedContent.startsWith(streamedContent)) {
                streamedContent = normalizedContent;
                this.emitConversationBotStream({
                  type: 'reply-delta',
                  conversationId,
                  triggerMessageId,
                  botId: bot.id,
                  botName,
                  messageId: replyMessage.id,
                  delta: normalizedContent,
                  content: normalizedContent,
                  model: meta?.rawModel,
                });
                return;
              }

              const delta = normalizedContent.slice(streamedContent.length);
              if (!delta) return;
              streamedContent = normalizedContent;
              this.emitConversationBotStream({
                type: 'reply-delta',
                conversationId,
                triggerMessageId,
                botId: bot.id,
                botName,
                messageId: replyMessage.id,
                delta,
                content: normalizedContent,
                model: meta?.rawModel,
              });
            },
          });

          replyText = normalizeReplyText(completion.content, bot.name);
          completionModel = completion.rawModel || '';
          usage = completion.usage || null;
        } else {
          const started = await this.codexAdapter.startRun({
            bot: {
              ...bot,
              runtimeConfig: resolveEffectiveBotRuntimeConfig(bot),
            },
            systemPrompt: effectiveSystemPrompt,
            taskPrompt: buildExternalAgentTask({
              conversationTitle: initialConversation.title,
              sourceMessage: latestUserMessage,
              sourceAuthor: '用户',
              threadContext: transcript,
              workspacePath: effectiveWorkspacePath,
              outputMode: 'stream-reply',
            }),
            workspacePath: effectiveWorkspacePath,
            onEvent: (event) => {
              if (event.type !== 'delta') return;
              this.emitConversationBotStream({
                type: 'reply-delta',
                conversationId,
                triggerMessageId,
                botId: bot.id,
                botName,
                messageId: replyMessage.id,
                delta: event.delta || '',
                content: event.content || '',
                model,
              });
            },
          });

          this.store.updateAiRun(runId, {
            metadata: {
              workspacePath: started.workspacePath,
              externalThreadId: started.thread?.id || null,
              rolloutPath: started.thread?.path || '',
            },
          });

          const completion = await started.completion;
          replyText = normalizeReplyText(completion.content, bot.name).trim() || String(completion.content || '').trim();
          completionModel = model;
        }

        if (!replyText) {
          throw new Error('Empty bot reply.');
        }

        replyMessage.content = replyText;
        replyMessage.status = 'success';
        replyMessages.push(replyMessage);
        this.emitConversationBotStream({
          type: 'reply-complete',
          conversationId,
          triggerMessageId,
          botId: bot.id,
          botName,
          messageId: replyMessage.id,
          content: replyText,
          model: completionModel,
        });
        this.store.completeAiRun(runId, {
          status: 'done',
          responseText: replyText,
          usage,
          outputMessageId: replyMessage.id,
        });
        results.push({
          botId: bot.id,
          botName: bot.name,
          status: 'replied',
          messageId: replyMessage.id,
          model: completionModel,
        });
      } catch (error) {
        this.emitConversationBotStream({
          type: 'reply-error',
          conversationId,
          triggerMessageId,
          botId: bot.id,
          botName: bot.binding?.alias || bot.name,
          messageId: typeof replyMessage?.id === 'string' ? replyMessage.id : crypto.randomUUID(),
          error: error instanceof Error ? error.message : 'Unknown bot reply error',
        });
        this.store.completeAiRun(runId, {
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Unknown bot reply error',
        });
        results.push({
          botId: bot.id,
          botName: bot.name,
          status: 'error',
          reason: error instanceof Error ? error.message : 'Unknown bot reply error',
        });
      }
    }

    this.store.updateTriggerMessageBotStatus({
      conversationId,
      messageId: triggerMessageId,
      items: collectBotTriggerStatusItems(results),
    });

    if (replyMessages.length === 0) {
      return {
        conversation: this.store.getConversation(conversationId) || initialConversation,
        results,
      };
    }

    const latestConversation = this.store.getConversation(conversationId);
    if (!latestConversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const insertionIndex = findInsertionIndex(latestConversation.messages, triggerMessageId);
    if (insertionIndex < 0) {
      return {
        conversation: latestConversation,
        results,
      };
    }

    const nextConversation = JSON.parse(JSON.stringify(latestConversation));
    const stampedReplies = stampRepliesForInsertion(replyMessages, nextConversation.messages, insertionIndex);
    nextConversation.messages.splice(insertionIndex, 0, ...stampedReplies);

    return {
      conversation: this.store.upsertConversation(nextConversation),
      results,
    };
  }
}

module.exports = {
  AiService,
};
