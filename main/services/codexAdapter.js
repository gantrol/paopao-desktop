const fs = require('node:fs');
const path = require('node:path');
const { CodexAppServerClient } = require('./codexAppServerClient');

function ensureDirectoryPath(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

function normalizeCodexConfig(config = {}) {
  const raw = config && typeof config === 'object' ? config : {};
  return {
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : null,
    approvalPolicy: typeof raw.approvalPolicy === 'string' && raw.approvalPolicy.trim()
      ? raw.approvalPolicy.trim()
      : 'never',
    sandbox: typeof raw.sandbox === 'string' && raw.sandbox.trim()
      ? raw.sandbox.trim()
      : 'workspace-write',
    effort: typeof raw.effort === 'string' && raw.effort.trim()
      ? raw.effort.trim()
      : 'medium',
    workspacePath: typeof raw.workspacePath === 'string' && raw.workspacePath.trim()
      ? raw.workspacePath.trim()
      : '',
  };
}

class CodexAdapter {
  constructor(options = {}) {
    this.clientInfo = options.clientInfo || { name: 'paopao-machine', version: '0.0.0' };
  }

  supports(bot) {
    return bot?.runtimeType === 'external-codex';
  }

  async startRun({
    bot,
    systemPrompt,
    taskPrompt,
    workspacePath,
    onEvent,
  }) {
    const runtimeConfig = normalizeCodexConfig(bot?.runtimeConfig);
    const resolvedWorkspacePath = ensureDirectoryPath(
      workspacePath,
      ensureDirectoryPath(runtimeConfig.workspacePath, process.cwd()),
    );
    const stats = fs.existsSync(resolvedWorkspacePath)
      ? fs.statSync(resolvedWorkspacePath)
      : null;
    if (!stats || !stats.isDirectory()) {
      throw new Error(`Codex 工作区不存在：${resolvedWorkspacePath}`);
    }

    const agentMessageOrder = [];
    const agentMessageText = new Map();
    let activeThread = null;
    let activeTurn = null;
    let finished = false;
    let completePromiseResolve;
    let completePromiseReject;

    const completion = new Promise((resolve, reject) => {
      completePromiseResolve = resolve;
      completePromiseReject = reject;
    });

    const client = new CodexAppServerClient({
      clientInfo: this.clientInfo,
      onNotification: (notification) => {
        if (!notification || typeof notification !== 'object') return;
        if (notification.method === 'item/started' && notification.params?.item?.type === 'agentMessage') {
          const itemId = notification.params.item.id;
          if (!agentMessageText.has(itemId)) {
            agentMessageOrder.push(itemId);
            agentMessageText.set(itemId, notification.params.item.text || '');
          }
          onEvent?.({
            type: 'agent-message-started',
            itemId,
          });
          return;
        }

        if (notification.method === 'item/agentMessage/delta') {
          const itemId = notification.params?.itemId;
          const delta = notification.params?.delta || '';
          const current = agentMessageText.get(itemId) || '';
          const next = `${current}${delta}`;
          agentMessageText.set(itemId, next);
          if (!agentMessageOrder.includes(itemId)) {
            agentMessageOrder.push(itemId);
          }
          onEvent?.({
            type: 'delta',
            itemId,
            delta,
            content: next,
          });
          return;
        }

        if (notification.method === 'item/completed' && notification.params?.item?.type === 'agentMessage') {
          const itemId = notification.params.item.id;
          const text = notification.params.item.text || '';
          if (!agentMessageOrder.includes(itemId)) {
            agentMessageOrder.push(itemId);
          }
          agentMessageText.set(itemId, text);
          onEvent?.({
            type: 'agent-message-completed',
            itemId,
            content: text,
          });
          return;
        }

        if (notification.method === 'turn/completed') {
          finished = true;
          const lastMessageId = agentMessageOrder[agentMessageOrder.length - 1] || '';
          const content = lastMessageId ? (agentMessageText.get(lastMessageId) || '') : '';
          completePromiseResolve({
            threadId: activeThread?.id || notification.params?.threadId || '',
            turnId: activeTurn?.id || notification.params?.turn?.id || '',
            rolloutPath: activeThread?.path || '',
            status: notification.params?.turn?.status || 'completed',
            content,
            turn: notification.params?.turn || null,
          });
          return;
        }

        if (notification.method === 'error') {
          const message = notification.params?.message || 'Codex 运行失败';
          completePromiseReject(new Error(message));
        }
      },
      onServerRequest: async (request, clientInstance) => {
        const reason = request?.params?.reason || 'Codex 请求额外授权';
        onEvent?.({
          type: 'requires-action',
          reason,
          requestMethod: request.method,
        });
        if (request.method === 'item/commandExecution/requestApproval') {
          clientInstance.sendResponse(request.id, { decision: 'decline' });
          return;
        }
        if (request.method === 'item/fileChange/requestApproval') {
          clientInstance.sendResponse(request.id, { decision: 'decline' });
          return;
        }
        if (request.method === 'applyPatchApproval') {
          clientInstance.sendResponse(request.id, { decision: 'denied' });
          return;
        }
        if (request.method === 'execCommandApproval') {
          clientInstance.sendResponse(request.id, { decision: 'denied' });
        }
      },
    });

    try {
      await client.start();

      activeThread = await client.request('thread/start', {
        model: runtimeConfig.model,
        modelProvider: null,
        cwd: resolvedWorkspacePath,
        approvalPolicy: runtimeConfig.approvalPolicy,
        sandbox: runtimeConfig.sandbox,
        config: null,
        baseInstructions: null,
        developerInstructions: systemPrompt || null,
        experimentalRawEvents: false,
      }).then((result) => result.thread ? result.thread : result);

      const turnResult = await client.request('turn/start', {
        threadId: activeThread.id,
        input: [{
          type: 'text',
          text: taskPrompt,
          text_elements: [],
        }],
        cwd: resolvedWorkspacePath,
        approvalPolicy: null,
        sandboxPolicy: null,
        model: runtimeConfig.model,
        effort: runtimeConfig.effort,
        summary: null,
        outputSchema: null,
      });
      activeTurn = turnResult.turn;
    } catch (error) {
      client.dispose();
      throw error;
    }

    const cancel = async () => {
      if (!client) return;
      if (activeThread?.id && activeTurn?.id && !finished) {
        try {
          await client.request('turn/interrupt', {
            threadId: activeThread.id,
            turnId: activeTurn.id,
          });
        } catch {
          // best effort
        }
      }
      client.dispose();
    };

    return {
      thread: activeThread,
      turn: activeTurn,
      workspacePath: resolvedWorkspacePath,
      completion: completion.finally(() => {
        client.dispose();
      }),
      cancel,
    };
  }
}

module.exports = {
  CodexAdapter,
  normalizeCodexConfig,
};
