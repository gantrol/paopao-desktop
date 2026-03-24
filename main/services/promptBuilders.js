function buildSourcesBlock(sources) {
  return sources
    .map((source, index) => {
      const text = (source.text || '').trim() || '（空内容）';
      return [
        `# Source ${index + 1}`,
        `id: ${source.id}`,
        `stream: ${source.streamTitle || source.streamId || 'unknown'}`,
        `kind: ${source.kind || 'bubble'}`,
        `time: ${source.time ?? 'unknown'}`,
        'content:',
        text,
      ].join('\n');
    })
    .join('\n\n');
}

function safeJsonParse(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function buildRefineMessages({ sources, objective, manualDraft }) {
  const goal = (objective || '').trim();
  const userDraft = (manualDraft || '').trim();

  const system = [
    '你是“泡泡分拣-提炼”编辑助手。你的任务是再编辑，不是搬运。',
    '再编辑要求：',
    '1) 提炼核心信息并重写表达，不能逐句照抄。',
    '2) 如果需要引用事实，只能以“来源引用”形式标注来源 id。',
    '3) 禁止出现与原文连续 20 个汉字完全一致的大片复制。',
    '4) 输出必须可继续人工编辑，结构清晰、简洁。',
    '5) 不要编造来源外的新事实；不确定就明确标注“待确认”。',
    '请严格输出 JSON，对象格式如下：',
    '{"title":"","refined":"","keyPoints":[""],"sourceIds":["source-id"]}',
    '除 JSON 外不要输出任何额外文本。',
  ].join('\n');

  const user = [
    goal ? `提炼目标:\n${goal}` : '提炼目标:\n请做一版通用再编辑，突出可执行结论。',
    userDraft ? `\n人工草稿（可参考并优化）:\n${userDraft}` : '',
    '\n源泡泡内容如下：',
    buildSourcesBlock(sources),
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function normalizeRefineResponse(rawText, sources) {
  const parsed = safeJsonParse(rawText);
  if (!parsed || typeof parsed !== 'object') {
    return {
      title: '提炼草稿',
      refined: rawText.trim(),
      keyPoints: [],
      sourceIds: sources.map((source) => source.id),
    };
  }

  const title = typeof parsed.title === 'string' && parsed.title.trim()
    ? parsed.title.trim()
    : '提炼草稿';
  const refined = typeof parsed.refined === 'string'
    ? parsed.refined.trim()
    : '';
  const keyPoints = Array.isArray(parsed.keyPoints)
    ? parsed.keyPoints.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];

  const validSourceIds = new Set(sources.map((source) => source.id));
  const sourceIds = Array.isArray(parsed.sourceIds)
    ? parsed.sourceIds.filter((item) => typeof item === 'string' && validSourceIds.has(item))
    : [];

  return {
    title,
    refined,
    keyPoints,
    sourceIds: sourceIds.length > 0 ? sourceIds : sources.map((source) => source.id),
  };
}

function buildFilterMessages({ sources, query }) {
  const system = [
    '你是“泡泡分拣”筛选助手。',
    '根据用户的自然语言条件，筛选最相关的 source id。',
    '筛选规则：',
    '1) 严格基于 sources 文本，不得臆造。',
    '2) 条件不充分时，优先少选而不是乱选。',
    '3) 结果最多返回 50 条 source id。',
    '请严格输出 JSON：{"sourceIds":["id1"],"reason":"简短说明"}',
    '不要输出 JSON 以外的内容。',
  ].join('\n');

  const user = [
    `筛选条件（自然语言）:\n${query}`,
    '\n候选 sources：',
    buildSourcesBlock(sources),
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function normalizeFilterResponse(rawText, sources) {
  const parsed = safeJsonParse(rawText);
  const validIds = new Set(sources.map((source) => source.id));

  if (!parsed || typeof parsed !== 'object') {
    return {
      sourceIds: [],
      reason: rawText.trim() || '模型未返回结构化筛选结果。',
    };
  }

  const sourceIds = Array.isArray(parsed.sourceIds)
    ? parsed.sourceIds.filter((item) => typeof item === 'string' && validIds.has(item)).slice(0, 50)
    : [];

  return {
    sourceIds,
    reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : '',
  };
}

function buildBotReplyMessages({
  botName,
  systemPrompt,
  conversationTitle,
  transcript,
  latestUserMessage,
  identity,
  relationPrompt,
  topicTitle,
  topicSummary,
}) {
  const system = [
    systemPrompt,
    relationPrompt ? `\n当前身份协作规则：\n${relationPrompt}` : '',
    '',
    '附加规则：',
    '1. 输出纯文本，不要使用 JSON。',
    '2. 不要复述系统提示，不要解释你是如何生成回复的。',
    '3. 回复必须与最近一条用户消息直接相关。',
    '4. 如果对话里已经有其他 bot 发言，可以保持自身角色稳定，不必模仿对方。',
  ].join('\n');

  const user = [
    `当前泡泡流：${conversationTitle || '未命名泡泡流'}`,
    `当前 bot：${botName}`,
    identity?.name ? `当前用户身份：${identity.name}` : '',
    identity?.description ? `身份描述：${identity.description}` : '',
    topicTitle ? `当前话题：${topicTitle}` : '',
    topicSummary ? `当前话题摘要：\n${topicSummary}` : '',
    '',
    '最近对话记录：',
    transcript || '（暂无历史记录）',
    '',
    '请基于上面的对话，以当前 bot 的身份回复最后一条用户消息。',
    latestUserMessage ? `最后一条用户消息：${latestUserMessage}` : '',
  ].filter(Boolean).join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildCommentMessages({
  botName,
  systemPrompt,
  conversationTitle,
  transcript,
  sourceMessage,
  sourceAuthor,
  threadContext,
}) {
  const system = [
    systemPrompt,
    '',
    '你现在不是在主泡泡流里继续闲聊，而是在给一条具体泡泡写评论。',
    '附加规则：',
    '1. 输出纯文本，不要使用 JSON。',
    '2. 直接围绕目标泡泡评论，不要假装成系统消息。',
    '3. 评论应尽量具体，优先指出观察、建议、关联或下一步。',
    '4. 除非内容明显需要展开，否则保持 1 到 3 段。',
    '5. 不要重复整条原泡泡；引用必要片段即可。',
  ].join('\n');

  const user = [
    `当前泡泡流：${conversationTitle || '未命名泡泡流'}`,
    `当前评论机器：${botName}`,
    '',
    '目标泡泡作者：',
    sourceAuthor || '用户',
    '',
    '目标泡泡内容：',
    sourceMessage || '（空内容）',
    '',
    '最近上下文：',
    transcript || '（暂无上下文）',
    '',
    '当前评论线程已有内容：',
    threadContext || '（暂无评论）',
    '',
    '请以当前机器的人格，为这条泡泡写一条评论。',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildExternalAgentTask({
  conversationTitle,
  sourceMessage,
  sourceAuthor,
  threadContext,
  workspacePath,
  extraPrompt,
  outputMode = 'thread-comment',
}) {
  const isStreamReply = outputMode === 'stream-reply';
  return [
    '你正在处理来自“泡泡”应用的一条消息。',
    '',
    `当前泡泡流：${conversationTitle || '未命名泡泡流'}`,
    workspacePath ? `当前工作区：${workspacePath}` : '',
    '',
    isStreamReply ? '最新用户消息作者：' : '源泡泡作者：',
    sourceAuthor || '用户',
    '',
    isStreamReply ? '最新用户消息：' : '源泡泡内容：',
    sourceMessage || '（空内容）',
    '',
    isStreamReply ? '最近对话上下文：' : '当前评论线程上下文：',
    threadContext || '（暂无评论）',
    extraPrompt ? `\n用户补充要求：\n${extraPrompt.trim()}\n` : '',
    '执行要求：',
    '1. 如果这条泡泡是在让你修改/分析当前工作区，请直接在工作区内完成。',
    '2. 如果泡泡只是想法或问题，请先在工作区中寻找相关上下文，再给出结论。',
    isStreamReply
      ? '3. 最终回复请使用简体中文，适合作为主泡泡流里的直接回复。'
      : '3. 最终回复请使用简体中文，适合作为这条泡泡下的一条评论。',
    '4. 最终回复尽量包含：做了什么、结果如何、涉及哪些关键文件或下一步建议。',
    '5. 不要输出 JSON。',
  ].join('\n');
}

module.exports = {
  buildCommentMessages,
  buildExternalAgentTask,
  buildRefineMessages,
  normalizeRefineResponse,
  buildFilterMessages,
  normalizeFilterResponse,
  buildBotReplyMessages,
};
