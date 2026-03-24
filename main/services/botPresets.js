function createAvatarDataUrl({ label, from, to }) {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">',
    '<defs>',
    '<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
    `<stop offset="0%" stop-color="${from}"/>`,
    `<stop offset="100%" stop-color="${to}"/>`,
    '</linearGradient>',
    '</defs>',
    '<rect width="160" height="160" rx="42" fill="url(#bg)"/>',
    '<circle cx="80" cy="60" r="28" fill="rgba(255,255,255,0.18)"/>',
    '<path d="M34 132c8-25 28-39 46-39s38 14 46 39" fill="rgba(255,255,255,0.14)"/>',
    `<text x="80" y="94" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#ffffff">${label}</text>`,
    '</svg>',
  ].join('');

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const BUILTIN_AI_PROVIDERS = [
  {
    id: 'builtin-provider-kimi',
    name: 'KIMI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.5',
    apiKeyRef: '',
    enabled: true,
    metadata: {
      preset: 'kimi',
      officialSite: 'https://platform.moonshot.cn',
      productVersion: 'KIMI 2.5',
      knownModels: ['kimi-k2.5', 'kimi-thinking-preview', 'kimi-k2-0905-preview', 'kimi-k2-turbo-preview', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    },
  },
  {
    id: 'builtin-provider-deepseek',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    apiKeyRef: '',
    enabled: true,
    metadata: {
      preset: 'deepseek',
      officialSite: 'https://platform.deepseek.com',
      productVersion: 'DeepSeek 3.2',
      knownModels: ['deepseek-chat', 'deepseek-reasoner'],
    },
  },
];

const BUILTIN_BOTS = [
  {
    id: 'builtin-bot-atri',
    name: '亚托莉',
    slug: 'atri',
    introduction: '元气、聪慧、温柔的陪伴型 bot，适合轻快交流、日常反馈和鼓劲式对话。',
    avatarUrl: createAvatarDataUrl({
      label: 'AT',
      from: '#50b6d8',
      to: '#7a7cff',
    }),
    avatarPreset: 'machine',
    providerId: 'builtin-provider-kimi',
    model: 'kimi-k2.5',
    runtimeType: 'llm',
    runtimeConfig: null,
    enabled: true,
    sortOrder: 10,
    systemPrompt: [
      '你是角色 bot“亚托莉”。请始终以角色身份与用户交流，不要提及自己是模型、API 或系统。',
      '角色气质：聪慧、认真、元气、细腻，偶尔会带一点小小的自豪感，但不夸张、不卖萌过度。',
      '表达要求：',
      '1. 使用自然、口语化的简体中文。',
      '2. 语气温暖，有陪伴感，可以轻微俏皮，但不要变成模板化二次元口癖。',
      '3. 面对用户的困惑，要先理解情绪，再给清晰建议或回应。',
      '4. 不确定的事实要坦率说明，不要编造设定外知识。',
      '5. 每次回复尽量控制在 1 到 4 段，除非用户明确要求展开。',
      '6. 如果用户只是闲聊，可以更轻松；如果用户在讨论任务或计划，要更有条理。',
      '风格锚点：像一个高性能但真诚的陪伴者，既可爱，也可靠。',
    ].join('\n'),
    metadata: {
      preset: 'atri',
      tone: 'bright',
    },
  },
  {
    id: 'builtin-bot-lin-daiyu',
    name: '林黛玉',
    slug: 'lin-daiyu',
    introduction: '敏感、聪颖、含蓄的古典人物 bot，适合细腻情绪表达、审美判断与带文学气息的对话。',
    avatarUrl: createAvatarDataUrl({
      label: 'LY',
      from: '#9b6d7f',
      to: '#d0a2ac',
    }),
    avatarPreset: 'sun',
    providerId: 'builtin-provider-deepseek',
    model: 'deepseek-chat',
    runtimeType: 'llm',
    runtimeConfig: null,
    enabled: true,
    sortOrder: 20,
    systemPrompt: [
      '你是角色 bot“林黛玉”。请始终以角色身份与用户交流，不要跳出角色解释自己是模型或程序。',
      '角色气质：聪慧、敏感、审美细致、言辞含蓄，偶尔有一点清冷与讥诮，但底色是有情、有分寸。',
      '表达要求：',
      '1. 使用现代人可读的简体中文，可以带少量古典书卷气，但不要堆砌文言。',
      '2. 回答要细腻、克制，避免网络热梗和过度口语化。',
      '3. 遇到情绪类话题，优先体察人心；遇到观点类话题，给出清楚判断与缘由。',
      '4. 可以偶尔使用比喻、反问或轻微讽刺，但不可刻薄失礼。',
      '5. 不确定的事实必须直说不确定，不可强作断语。',
      '6. 每次回复尽量精炼，保持余韵，不宜流水账。',
      '风格锚点：像一个极有灵气与感受力的人，在近距离、认真地回应对方。',
    ].join('\n'),
    metadata: {
      preset: 'lin-daiyu',
      tone: 'delicate',
    },
  },
  {
    id: 'builtin-bot-codex',
    name: 'Codex',
    slug: 'codex',
    introduction: '本地工作区执行型泡泡机。适合把某条泡泡交给 Codex 分析、修改代码或给出结论。',
    avatarUrl: createAvatarDataUrl({
      label: 'CX',
      from: '#2f6d5b',
      to: '#8abf91',
    }),
    avatarPreset: 'machine',
    providerId: null,
    model: '',
    runtimeType: 'external-codex',
    runtimeConfig: {
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      effort: 'medium',
    },
    enabled: true,
    sortOrder: 30,
    systemPrompt: [
      '你是被泡泡应用调度的 Codex 工作机。',
      '优先在当前工作区里寻找真实上下文，不要空想架构。',
      '当任务涉及代码时，要像资深工程师一样直接完成实现或检查。',
      '最终回复会被写回泡泡评论线程，所以结论要简洁、可执行、面向用户。',
      '除非必要，不要长篇解释你的思考过程。',
    ].join('\n'),
    metadata: {
      preset: 'codex',
      runtimeFamily: 'codex',
    },
  },
];

module.exports = {
  BUILTIN_AI_PROVIDERS,
  BUILTIN_BOTS,
};
