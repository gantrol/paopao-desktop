function createAvatarDataUrl({
  label = 'AI',
  from = '#5B8DEF',
  to = '#7F56D9',
} = {}) {
  const safeLabel = String(label || 'AI').slice(0, 2).toUpperCase();
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">',
    '<defs>',
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0%" stop-color="${from}"/>`,
    `<stop offset="100%" stop-color="${to}"/>`,
    '</linearGradient>',
    '</defs>',
    '<rect width="160" height="160" rx="40" fill="url(#g)"/>',
    '<circle cx="80" cy="60" r="28" fill="rgba(255,255,255,0.18)"/>',
    '<path d="M34 132c8-25 28-39 46-39s38 14 46 39" fill="rgba(255,255,255,0.14)"/>',
    `<text x="80" y="94" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#ffffff">${safeLabel}</text>`,
    '</svg>',
  ].join('');

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const DEFAULT_IDENTITY_AVATAR_PRESET = 'sun';

/**
 * 这里开始是你后续主要维护的初始化数据
 * 只改这个文件即可
 */
const INITIAL_IDENTITIES = [
  {
    id: 'builtin-identity-default-self',
    name: '默认的我',
    description: '未特别指定场景时使用的默认身份。',
    avatarPreset: DEFAULT_IDENTITY_AVATAR_PRESET,
    enabled: true,
    sortOrder: 10,
  },
];

const INITIAL_AI_PROVIDERS = [
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
      knownModels: [
        'kimi-k2.5',
        'kimi-thinking-preview',
        'kimi-k2-0905-preview',
        'kimi-k2-turbo-preview',
        'moonshot-v1-8k',
        'moonshot-v1-32k',
        'moonshot-v1-128k',
      ],
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

const INITIAL_BOTS = [
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

/**
 * 新建箱子的默认 column
 * 我这里改成了更通用的新手方案：
 * 收件箱 -> 下一步 -> 沉淀
 */
const INITIAL_SORTING_BOX_TEMPLATE_COLUMNS = ['收件箱', '下一步', '沉淀'];
const INITIAL_ROOT_INBOX_LAYER_RAW_ID = 'l_root_inbox';
const INITIAL_LUGGAGE_LAYER_RAW_ID = 'luggage';
const INITIAL_LUGGAGE_LAYER_NAME = '行李箱';

const LEGACY_SORTING_COLUMN_NAME_MIGRATIONS = Object.freeze([]);

function buildTemplateColumns(boxId, prefix) {
  return [
    { id: `l_${prefix}_inbox`, boxId, name: '收件箱' },
    { id: `l_${prefix}_next`, boxId, name: '下一步' },
    { id: `l_${prefix}_archive`, boxId, name: '沉淀' },
  ];
}

/**
 * 默认工作区初始化
 * 继续沿用原来的 box id，减少迁移影响：
 * b_root / b_prog / b_life / b_aicando_periodical
 */
function buildInitialSortingWorkspaceSeed() {
  const boxes = [
    {
      id: 'b_root',
      name: '开始这里',
      tone: '#2A8A61',
      description: '新用户入口：先看指引，再进入自己的箱子。',
    },
    {
      id: 'b_prog',
      name: '收集箱',
      tone: '#266D8A',
      description: '把任务、想法、资料先放进来，不着急一次分类完。',
    },
    {
      id: 'b_life',
      name: '推进箱',
      tone: '#A56C2E',
      description: '把真正要处理的事情往前推进。',
    },
    {
      id: 'b_aicando_periodical',
      name: '沉淀箱',
      tone: '#7E6AAE',
      description: '保存整理后的结论、模板、清单与参考资料。',
    },
  ];

  const columns = [
    { id: 'l_root_inbox', boxId: 'b_root', name: '新手指引' },
    ...buildTemplateColumns('b_prog', 'prog'),
    ...buildTemplateColumns('b_life', 'life'),
    ...buildTemplateColumns('b_aicando_periodical', 'aicando'),
  ];

  const cards = [
    {
      id: 'guide_welcome',
      layerId: 'l_root_inbox',
      type: 'card',
      title: '欢迎使用',
      content: [
        '建议先按一个最小流程上手：先收集，再推进，最后沉淀。',
        '',
        '不用一开始就设计很复杂的结构，先把内容放进来最重要。',
      ].join('\n'),
    },
    {
      id: 'guide_step_1',
      layerId: 'l_root_inbox',
      type: 'card',
      title: '第一步：把内容先丢进收集箱',
      content: [
        '适合放：',
        '- 临时想法',
        '- 待办事项',
        '- 参考链接',
        '- 还没想清楚的素材',
      ].join('\n'),
    },
    {
      id: 'guide_step_2',
      layerId: 'l_root_inbox',
      type: 'card',
      title: '第二步：准备处理时，再移动到推进箱',
      content: [
        '只把真正要做的东西放进推进箱。',
        '这样能把“我记下来了”和“我现在要做”分开。',
      ].join('\n'),
    },
    {
      id: 'guide_step_3',
      layerId: 'l_root_inbox',
      type: 'card',
      title: '第三步：做完后，把结果放进沉淀箱',
      content: [
        '适合放：',
        '- 结论',
        '- 模板',
        '- 操作步骤',
        '- 已整理过的资料',
      ].join('\n'),
    },
    {
      id: 'guide_hint',
      layerId: 'l_root_inbox',
      type: 'card',
      title: '默认 column 为什么这样设计',
      content: [
        '收件箱：先接住内容',
        '下一步：只放要推进的事',
        '沉淀：留住已经整理好的东西',
        '',
        '这套结构对新用户最稳，也最容易长期维护。',
      ].join('\n'),
    },

    { id: 'i_b1', layerId: 'l_root_inbox', type: 'box', childBoxId: 'b_prog' },
    { id: 'i_b2', layerId: 'l_root_inbox', type: 'box', childBoxId: 'b_life' },
    { id: 'i_b3', layerId: 'l_root_inbox', type: 'box', childBoxId: 'b_aicando_periodical' },
  ];

  return {
    activeBoxId: 'b_root',
    boxes,
    columns,
    cards,
  };
}

module.exports = {
  DEFAULT_IDENTITY_AVATAR_PRESET,
  INITIAL_IDENTITIES,
  INITIAL_AI_PROVIDERS,
  INITIAL_BOTS,
  INITIAL_SORTING_BOX_TEMPLATE_COLUMNS,
  INITIAL_ROOT_INBOX_LAYER_RAW_ID,
  INITIAL_LUGGAGE_LAYER_RAW_ID,
  INITIAL_LUGGAGE_LAYER_NAME,
  LEGACY_SORTING_COLUMN_NAME_MIGRATIONS,
  buildInitialSortingWorkspaceSeed,
};
