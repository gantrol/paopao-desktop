const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("paopao", {
  environment: {
    runtime: "desktop",
  },
  conversations: {
    list: () => ipcRenderer.invoke("conversation:list"),
    get: (conversationId) =>
      ipcRenderer.invoke("conversation:get", conversationId),
    save: (payload) => ipcRenderer.invoke("conversation:save", payload),
    create: (payload) => ipcRenderer.invoke("conversation:create", payload),
    clear: (conversationId) =>
      ipcRenderer.invoke("conversation:clear", conversationId),
    updateMeta: (payload) =>
      ipcRenderer.invoke("conversation:update-meta", payload),
  },
  messages: {
    send: (payload) => ipcRenderer.invoke("message:send", payload),
    update: (payload) => ipcRenderer.invoke("message:update", payload),
    delete: (payload) => ipcRenderer.invoke("message:delete", payload),
    quote: (payload) => ipcRenderer.invoke("message:quote", payload),
    comment: (payload) => ipcRenderer.invoke("message:comment", payload),
    toggleLike: (payload) => ipcRenderer.invoke("message:toggle-like", payload),
  },
  assets: {
    importFile: (payload) => ipcRenderer.invoke("asset:import-file", payload),
    importFiles: (payload) => ipcRenderer.invoke("asset:import-files", payload),
    open: (target) => ipcRenderer.invoke("asset:open", target),
  },
  sorting: {
    get: () => ipcRenderer.invoke("sorting:get"),
    save: (payload) => ipcRenderer.invoke("sorting:save", payload),
    move: (payload) => ipcRenderer.invoke("sorting:move", payload),
    update: (payload) => ipcRenderer.invoke("sorting:update", payload),
  },
  linkPreview: {
    get: (url) => ipcRenderer.invoke("link-preview:get", url),
  },
  ai: {
    refine: (payload) => ipcRenderer.invoke("ai:refine", payload),
    filter: (payload) => ipcRenderer.invoke("ai:filter", payload),
    triggerConversationBots: (payload) =>
      ipcRenderer.invoke("ai:trigger-conversation-bots", payload),
    triggerMachineRun: (payload) =>
      ipcRenderer.invoke("ai:trigger-machine-run", payload),
    cancelMachineRun: (payload) =>
      ipcRenderer.invoke("ai:cancel-machine-run", payload),
    onConversationBotStream: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("ai:conversation-bot-stream", handler);
      return () =>
        ipcRenderer.removeListener("ai:conversation-bot-stream", handler);
    },
    onMachineRunStream: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("ai:machine-run-stream", handler);
      return () => ipcRenderer.removeListener("ai:machine-run-stream", handler);
    },
  },
  settings: {
    listAiProviders: () => ipcRenderer.invoke("settings:list-ai-providers"),
    saveAiProvider: (payload) =>
      ipcRenderer.invoke("settings:save-ai-provider", payload),
    listBots: (payload) => ipcRenderer.invoke("settings:list-bots", payload),
    listBotConversations: (botId) =>
      ipcRenderer.invoke("settings:list-bot-conversations", botId),
    saveBot: (payload) => ipcRenderer.invoke("settings:save-bot", payload),
    getUserProfile: () => ipcRenderer.invoke("settings:get-user-profile"),
    saveUserProfile: (payload) =>
      ipcRenderer.invoke("settings:save-user-profile", payload),
  },
  bots: {
    ensureDirectConversation: (botId) =>
      ipcRenderer.invoke("bots:ensure-direct-conversation", botId),
    saveBinding: (payload) =>
      ipcRenderer.invoke("conversation:save-bot-binding", payload),
  },
  system: {
    getInfo: () => ipcRenderer.invoke("system:get-info"),
    exportData: () => ipcRenderer.invoke("system:export-data"),
  },
});
