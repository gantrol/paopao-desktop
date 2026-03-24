import { useEffect, useMemo, useState } from 'react';
import type { BotRecord, BotRuntimeType } from '@/entities/bot';
import type { AiProviderRecord } from '@/entities/provider';
import { NEW_BOT_ID } from '@/features/manage-bot/model/form';
import { NEW_PROVIDER_ID } from '@/features/manage-provider/model/form';
import { STREAM_AVATAR_PRESETS } from '@/shared/config/avatar';
import { BubbleMachineIcon } from '@/shared/icons/AvatarIcons';
import { StreamAvatar } from '@/shared/ui/StreamAvatar';

type FactorySection = 'bots' | 'providers';

interface ProviderDraft {
  id?: string;
  name: string;
  kind: string;
  baseUrl: string;
  defaultModel: string;
  apiKey: string;
  clearApiKey: boolean;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyStorage: string;
}

interface BotDraft {
  id?: string;
  name: string;
  slug: string;
  introduction: string;
  avatarUrl: string;
  avatarPreset: string;
  providerId: string;
  model: string;
  runtimeType: BotRuntimeType;
  runtimeConfig: Record<string, unknown>;
  systemPrompt: string;
  enabled: boolean;
  metadata: Record<string, unknown> | null;
}

function getDefaultSystemPrompt(runtimeType: BotRuntimeType) {
  if (runtimeType === 'external-codex') {
    return [
      '你是被泡泡应用调度的 Codex 工作机。',
      '优先根据真实工作区和泡泡上下文完成分析或实现。',
      '最终回复会写回泡泡评论线程，所以结论要简洁、可执行、面向用户。',
    ].join('\n');
  }

  return [
    '你是被泡泡应用调度的评论型泡泡机。',
    '请基于当前泡泡和上下文直接生成一条自然、简洁、有帮助的评论。',
    '避免解释自己是模型、系统或应用。',
  ].join('\n');
}

function normalizeRuntimeConfig(runtimeConfig: Record<string, unknown> | null | undefined) {
  return runtimeConfig && typeof runtimeConfig === 'object' ? { ...runtimeConfig } : {};
}

function getRuntimeConfigValue(runtimeConfig: Record<string, unknown>, key: string, fallback = '') {
  const value = runtimeConfig[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function createProviderDraft(provider?: AiProviderRecord | null): ProviderDraft {
  if (!provider) {
    return {
      name: '',
      kind: 'openai-compatible',
      baseUrl: '',
      defaultModel: '',
      apiKey: '',
      clearApiKey: false,
      enabled: true,
      hasApiKey: false,
      apiKeyStorage: '',
    };
  }

  return {
    id: provider.id,
    name: provider.name || '',
    kind: provider.kind || 'openai-compatible',
    baseUrl: provider.baseUrl || '',
    defaultModel: provider.defaultModel || '',
    apiKey: '',
    clearApiKey: false,
    enabled: provider.enabled,
    hasApiKey: Boolean(provider.hasApiKey),
    apiKeyStorage: provider.apiKeyStorage || '',
  };
}

function createBotDraft(
  bot: BotRecord | null | undefined,
  defaultProviderId: string,
  defaultWorkspacePath: string,
): BotDraft {
  if (!bot) {
    return {
      name: '',
      slug: '',
      introduction: '',
      avatarUrl: '',
      avatarPreset: 'machine',
      providerId: defaultProviderId,
      model: '',
      runtimeType: 'llm',
      runtimeConfig: {
        workspacePath: defaultWorkspacePath,
        approvalPolicy: 'never',
        sandbox: 'workspace-write',
        effort: 'medium',
      },
      systemPrompt: getDefaultSystemPrompt('llm'),
      enabled: true,
      metadata: null,
    };
  }

  const runtimeConfig = normalizeRuntimeConfig(bot.runtimeConfig);
  if (bot.runtimeType === 'external-codex' && !getRuntimeConfigValue(runtimeConfig, 'workspacePath')) {
    runtimeConfig.workspacePath = defaultWorkspacePath;
  }

  return {
    id: bot.id,
    name: bot.name || '',
    slug: bot.slug || '',
    introduction: bot.introduction || '',
    avatarUrl: bot.avatarUrl || '',
    avatarPreset: bot.avatarPreset || 'machine',
    providerId: bot.providerId || defaultProviderId,
    model: bot.model || bot.providerDefaultModel || '',
    runtimeType: bot.runtimeType || 'llm',
    runtimeConfig,
    systemPrompt: bot.systemPrompt || getDefaultSystemPrompt(bot.runtimeType || 'llm'),
    enabled: bot.enabled,
    metadata: bot.metadata || null,
  };
}

function getRuntimeLabel(runtimeType: BotRuntimeType) {
  return runtimeType === 'external-codex' ? 'Codex' : 'LLM';
}

export function FactoryPage({
  bots,
  providers,
  defaultWorkspacePath,
  onSaveBot,
  onSaveProvider,
}: {
  bots: BotRecord[];
  providers: AiProviderRecord[];
  defaultWorkspacePath: string;
  onSaveBot: (payload: Record<string, unknown>) => Promise<string>;
  onSaveProvider: (payload: Record<string, unknown>) => Promise<string>;
}) {
  const [section, setSection] = useState<FactorySection>('bots');
  const [selectedBotId, setSelectedBotId] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [botDraft, setBotDraft] = useState<BotDraft>(() => createBotDraft(null, '', defaultWorkspacePath));
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(() => createProviderDraft(null));
  const [savingBot, setSavingBot] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);

  const defaultProviderId = providers[0]?.id || '';
  const selectedBot = useMemo(
    () => (selectedBotId && selectedBotId !== NEW_BOT_ID
      ? bots.find((bot) => bot.id === selectedBotId) || null
      : null),
    [bots, selectedBotId],
  );
  const selectedProvider = useMemo(
    () => (selectedProviderId && selectedProviderId !== NEW_PROVIDER_ID
      ? providers.find((provider) => provider.id === selectedProviderId) || null
      : null),
    [providers, selectedProviderId],
  );
  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === botDraft.providerId) || null,
    [botDraft.providerId, providers],
  );

  useEffect(() => {
    if (bots.length === 0) {
      setSelectedBotId(NEW_BOT_ID);
      return;
    }
    if (!selectedBotId || (selectedBotId !== NEW_BOT_ID && !bots.some((bot) => bot.id === selectedBotId))) {
      setSelectedBotId(bots[0].id);
    }
  }, [bots, selectedBotId]);

  useEffect(() => {
    if (providers.length === 0) {
      setSelectedProviderId(NEW_PROVIDER_ID);
      return;
    }
    if (!selectedProviderId || (selectedProviderId !== NEW_PROVIDER_ID && !providers.some((provider) => provider.id === selectedProviderId))) {
      setSelectedProviderId(providers[0].id);
    }
  }, [providers, selectedProviderId]);

  useEffect(() => {
    setBotDraft(createBotDraft(selectedBot, defaultProviderId, defaultWorkspacePath));
  }, [defaultProviderId, defaultWorkspacePath, selectedBot]);

  useEffect(() => {
    setProviderDraft(createProviderDraft(selectedProvider));
  }, [selectedProvider]);

  const handleSaveProvider = async () => {
    setSavingProvider(true);
    try {
      const nextId = await onSaveProvider({
        id: providerDraft.id,
        name: providerDraft.name,
        kind: providerDraft.kind,
        baseUrl: providerDraft.baseUrl,
        defaultModel: providerDraft.defaultModel,
        enabled: providerDraft.enabled,
        apiKey: providerDraft.apiKey,
        clearApiKey: providerDraft.clearApiKey,
      });
      setSelectedProviderId(nextId);
    } finally {
      setSavingProvider(false);
    }
  };

  const handleSaveBot = async () => {
    setSavingBot(true);
    try {
      const nextId = await onSaveBot({
        id: botDraft.id,
        name: botDraft.name,
        slug: botDraft.slug,
        introduction: botDraft.introduction,
        avatarUrl: botDraft.avatarUrl,
        avatarPreset: botDraft.avatarPreset,
        providerId: botDraft.runtimeType === 'llm' ? botDraft.providerId : null,
        model: botDraft.model,
        runtimeType: botDraft.runtimeType,
        runtimeConfig: botDraft.runtimeConfig,
        systemPrompt: botDraft.systemPrompt,
        enabled: botDraft.enabled,
        metadata: botDraft.metadata,
      });
      setSelectedBotId(nextId);
    } finally {
      setSavingBot(false);
    }
  };

  return (
    <div className="pane factory-pane">
      <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(145deg,#eff4ee_0%,#f8fbf7_40%,#ffffff_100%)]">
        <div className="border-b border-black/6 px-6 py-5 md:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.26em] text-[var(--text-secondary)]">Factory</div>
              <h2 className="mt-2 text-3xl font-bold text-[var(--text-primary)]">泡泡机工厂</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
                在这里统一配置供应商和泡泡机本体。配置完成后，回到任意泡泡，右键选择“投入泡泡机”即可让它写评论。
              </p>
            </div>
            <div className="rounded-[22px] border border-[rgba(42,138,97,0.12)] bg-white/80 px-4 py-3 text-xs leading-6 text-[var(--text-secondary)] shadow-[0_12px_30px_rgba(23,38,28,0.06)]">
              <div>当前已启用机器：{bots.filter((bot) => bot.enabled).length}</div>
              <div>当前供应商：{providers.length}</div>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="min-h-0 border-r border-black/6 bg-white/80 p-4 backdrop-blur-sm">
            <div className="rounded-[24px] bg-[var(--tool-bg)] p-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`flex-1 rounded-[18px] px-4 py-3 text-sm font-semibold transition ${section === 'bots' ? 'bg-white text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-secondary)]'}`}
                  onClick={() => setSection('bots')}
                >
                  泡泡机
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-[18px] px-4 py-3 text-sm font-semibold transition ${section === 'providers' ? 'bg-white text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-secondary)]'}`}
                  onClick={() => setSection('providers')}
                >
                  供应商
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {section === 'bots' ? '已配置泡泡机' : '已配置供应商'}
              </div>
              <button
                type="button"
                className="rounded-full bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white"
                onClick={() => {
                  if (section === 'bots') {
                    setSelectedBotId(NEW_BOT_ID);
                  } else {
                    setSelectedProviderId(NEW_PROVIDER_ID);
                  }
                }}
              >
                {section === 'bots' ? '新建泡泡机' : '新建供应商'}
              </button>
            </div>

            <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
              {section === 'bots' ? (
                <>
                  {bots.map((bot) => {
                    const isActive = selectedBotId === bot.id;
                    return (
                      <button
                        key={bot.id}
                        type="button"
                        className={`rounded-[24px] border px-4 py-4 text-left transition ${isActive ? 'border-[var(--accent)] bg-[var(--bubble-me)] shadow-sm' : 'border-black/6 bg-white hover:border-[rgba(42,138,97,0.18)] hover:bg-[rgba(255,255,255,0.95)]'}`}
                        onClick={() => setSelectedBotId(bot.id)}
                      >
                        <div className="flex items-start gap-3">
                          {bot.avatarUrl ? (
                            <img src={bot.avatarUrl} alt={bot.name} className="h-12 w-12 rounded-[18px] object-cover" />
                          ) : (
                            <StreamAvatar
                              title={bot.name}
                              preset={bot.avatarPreset || 'machine'}
                              idOffset={`factory-bot-${bot.id}`}
                              className="h-12 w-12 rounded-[18px]"
                              iconClassName="text-base font-semibold text-white"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="truncate text-sm text-[var(--text-primary)]">{bot.name}</strong>
                              <span className="rounded-full bg-black/[0.05] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                                {getRuntimeLabel(bot.runtimeType)}
                              </span>
                              {bot.enabled ? null : (
                                <span className="rounded-full bg-[rgba(203,71,71,0.08)] px-2 py-1 text-[10px] font-semibold text-[#a94c4c]">停用</span>
                              )}
                            </div>
                            <div className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">
                              {bot.introduction || '暂无简介'}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--text-secondary)]">
                              {bot.runtimeType === 'llm' ? (
                                <span className="rounded-full bg-[var(--tool-bg)] px-3 py-1">
                                  {bot.providerName || '未绑定供应商'}
                                </span>
                              ) : null}
                              {bot.model ? (
                                <span className="rounded-full bg-[var(--tool-bg)] px-3 py-1">{bot.model}</span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`rounded-[24px] border border-dashed px-4 py-4 text-left transition ${selectedBotId === NEW_BOT_ID ? 'border-[var(--accent)] bg-[var(--bubble-me)]' : 'border-black/12 bg-white hover:border-[rgba(42,138,97,0.22)]'}`}
                    onClick={() => setSelectedBotId(NEW_BOT_ID)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-12 w-12 place-items-center rounded-[18px] bg-[var(--tool-bg)] text-[var(--accent)]">
                        <BubbleMachineIcon className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[var(--text-primary)]">新建泡泡机</div>
                        <div className="mt-1 text-xs text-[var(--text-secondary)]">创建新的评论机器或 Codex 工作机。</div>
                      </div>
                    </div>
                  </button>
                </>
              ) : (
                <>
                  {providers.map((provider) => {
                    const isActive = selectedProviderId === provider.id;
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        className={`rounded-[24px] border px-4 py-4 text-left transition ${isActive ? 'border-[var(--accent)] bg-[var(--bubble-me)] shadow-sm' : 'border-black/6 bg-white hover:border-[rgba(42,138,97,0.18)] hover:bg-[rgba(255,255,255,0.95)]'}`}
                        onClick={() => setSelectedProviderId(provider.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <strong className="block truncate text-sm text-[var(--text-primary)]">{provider.name}</strong>
                            <div className="mt-2 line-clamp-2 break-all text-xs leading-5 text-[var(--text-secondary)]">
                              {provider.baseUrl || '未填写 Base URL'}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--text-secondary)]">
                              <span className="rounded-full bg-[var(--tool-bg)] px-3 py-1">{provider.defaultModel || '未设置默认模型'}</span>
                              <span className="rounded-full bg-[var(--tool-bg)] px-3 py-1">{provider.hasApiKey ? '已存 API Key' : '未存 API Key'}</span>
                            </div>
                          </div>
                          {provider.enabled ? null : (
                            <span className="rounded-full bg-[rgba(203,71,71,0.08)] px-2 py-1 text-[10px] font-semibold text-[#a94c4c]">停用</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`rounded-[24px] border border-dashed px-4 py-4 text-left transition ${selectedProviderId === NEW_PROVIDER_ID ? 'border-[var(--accent)] bg-[var(--bubble-me)]' : 'border-black/12 bg-white hover:border-[rgba(42,138,97,0.22)]'}`}
                    onClick={() => setSelectedProviderId(NEW_PROVIDER_ID)}
                  >
                    <div className="text-sm font-semibold text-[var(--text-primary)]">新建供应商</div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">接一个新的 OpenAI 兼容模型入口。</div>
                  </button>
                </>
              )}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto px-5 py-5 md:px-8 md:py-6">
            {section === 'bots' ? (
              <div className="mx-auto max-w-4xl space-y-5">
                <div className="rounded-[30px] border border-black/6 bg-white/90 p-6 shadow-[0_18px_40px_rgba(23,38,28,0.06)]">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      {botDraft.avatarUrl ? (
                        <img src={botDraft.avatarUrl} alt={botDraft.name || '泡泡机'} className="h-16 w-16 rounded-[22px] object-cover" />
                      ) : (
                        <StreamAvatar
                          title={botDraft.name || '泡泡机'}
                          preset={botDraft.avatarPreset || 'machine'}
                          idOffset={`factory-bot-preview-${botDraft.id || 'new'}`}
                          className="h-16 w-16 rounded-[22px]"
                          iconClassName="text-lg font-semibold text-white"
                        />
                      )}
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-secondary)]">Bubble Machine</div>
                        <h3 className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
                          {selectedBotId === NEW_BOT_ID ? '新建泡泡机' : (botDraft.name || '未命名泡泡机')}
                        </h3>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
                          <span className="rounded-full bg-[var(--tool-bg)] px-3 py-1">{getRuntimeLabel(botDraft.runtimeType)}</span>
                          <span className="rounded-full bg-[var(--tool-bg)] px-3 py-1">{botDraft.enabled ? '已启用' : '已停用'}</span>
                          {botDraft.runtimeType === 'llm' && activeProvider ? (
                            <span className="rounded-full bg-[var(--tool-bg)] px-3 py-1">{activeProvider.name}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="max-w-sm rounded-[22px] bg-[var(--tool-bg)] px-4 py-3 text-xs leading-6 text-[var(--text-secondary)]">
                      这个页面只配置机器本体和默认运行参数。实际使用时，在消息区右键某条泡泡，选“投入泡泡机”再点它。
                    </div>
                  </div>
                </div>

                <div className="rounded-[30px] border border-black/6 bg-white/90 p-6 shadow-[0_18px_40px_rgba(23,38,28,0.05)]">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="bot-form-field">
                      <span>名称</span>
                      <input
                        value={botDraft.name}
                        onChange={(event) => setBotDraft((prev) => ({ ...prev, name: event.target.value }))}
                        placeholder="比如：亚托莉评论机"
                      />
                    </label>
                    <label className="bot-form-field">
                      <span>Slug</span>
                      <input
                        value={botDraft.slug}
                        onChange={(event) => setBotDraft((prev) => ({ ...prev, slug: event.target.value }))}
                        placeholder="可选，用于内部标识"
                      />
                    </label>
                    <label className="bot-form-field">
                      <span>运行时</span>
                      <select
                        value={botDraft.runtimeType}
                        onChange={(event) => {
                          const nextRuntimeType = event.target.value as BotRuntimeType;
                          setBotDraft((prev) => {
                            const nextRuntimeConfig = { ...prev.runtimeConfig };
                            if (nextRuntimeType === 'external-codex' && !getRuntimeConfigValue(nextRuntimeConfig, 'workspacePath')) {
                              nextRuntimeConfig.workspacePath = defaultWorkspacePath;
                            }
                            const shouldReplacePrompt = !prev.systemPrompt.trim() || prev.systemPrompt === getDefaultSystemPrompt(prev.runtimeType);
                            return {
                              ...prev,
                              runtimeType: nextRuntimeType,
                              systemPrompt: shouldReplacePrompt ? getDefaultSystemPrompt(nextRuntimeType) : prev.systemPrompt,
                              runtimeConfig: nextRuntimeConfig,
                            };
                          });
                        }}
                      >
                        <option value="llm">LLM 评论机</option>
                        <option value="external-codex">Codex 工作机</option>
                      </select>
                    </label>
                    <label className="bot-form-field">
                      <span>启用状态</span>
                      <select
                        value={botDraft.enabled ? 'enabled' : 'disabled'}
                        onChange={(event) => setBotDraft((prev) => ({ ...prev, enabled: event.target.value === 'enabled' }))}
                      >
                        <option value="enabled">已启用</option>
                        <option value="disabled">已停用</option>
                      </select>
                    </label>
                  </div>

                  <label className="bot-form-field mt-4">
                    <span>简介</span>
                    <textarea
                      className="min-h-[88px]"
                      value={botDraft.introduction}
                      onChange={(event) => setBotDraft((prev) => ({ ...prev, introduction: event.target.value }))}
                      placeholder="一句话描述这个泡泡机适合做什么"
                    />
                  </label>

                  <div className="mt-4">
                    <span className="text-sm font-medium text-[var(--text-secondary)]">头像风格</span>
                    <div className="mt-3 grid grid-cols-4 gap-3 md:grid-cols-6">
                      {STREAM_AVATAR_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className={`rounded-[20px] border p-3 transition ${botDraft.avatarPreset === preset.id ? 'border-[var(--accent)] bg-[var(--bubble-me)]' : 'border-black/8 bg-[var(--tool-bg)]'}`}
                          onClick={() => setBotDraft((prev) => ({ ...prev, avatarPreset: preset.id, avatarUrl: '' }))}
                        >
                          <div className="flex flex-col items-center gap-2">
                            <StreamAvatar
                              title={botDraft.name || '泡泡机'}
                              preset={preset.id}
                              idOffset={`factory-preset-${preset.id}`}
                              className="h-10 w-10 rounded-[16px]"
                              iconClassName="text-sm font-semibold text-white"
                            />
                            <span className="text-[11px] text-[var(--text-secondary)]">{preset.label}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {botDraft.runtimeType === 'llm' ? (
                    <div className="mt-5 rounded-[24px] bg-[var(--tool-bg)] p-4">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">模型配置</div>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="bot-form-field">
                          <span>供应商</span>
                          <select
                            value={botDraft.providerId}
                            onChange={(event) => setBotDraft((prev) => ({ ...prev, providerId: event.target.value }))}
                          >
                            <option value="">未选择</option>
                            {providers.map((provider) => (
                              <option key={provider.id} value={provider.id}>{provider.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="bot-form-field">
                          <span>模型</span>
                          <input
                            value={botDraft.model}
                            onChange={(event) => setBotDraft((prev) => ({ ...prev, model: event.target.value }))}
                            placeholder={activeProvider?.defaultModel || '比如：gpt-4.1 / kimi-k2.5'}
                          />
                        </label>
                      </div>
                      {activeProvider ? (
                        <div className="mt-4 rounded-[20px] border border-black/6 bg-white px-4 py-3 text-xs leading-6 text-[var(--text-secondary)]">
                          <div>{activeProvider.baseUrl || '未配置 Base URL'}</div>
                          <div>{activeProvider.hasApiKey ? `API Key 已存到 ${activeProvider.apiKeyStorage || '安全存储'}` : '尚未保存 API Key'}</div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-5 rounded-[24px] bg-[var(--tool-bg)] p-4">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">Codex 默认运行参数</div>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="bot-form-field">
                          <span>工作区路径</span>
                          <input
                            value={getRuntimeConfigValue(botDraft.runtimeConfig, 'workspacePath', defaultWorkspacePath)}
                            onChange={(event) => setBotDraft((prev) => ({
                              ...prev,
                              runtimeConfig: {
                                ...prev.runtimeConfig,
                                workspacePath: event.target.value,
                              },
                            }))}
                            placeholder={defaultWorkspacePath || '/absolute/path/to/workspace'}
                          />
                        </label>
                        <label className="bot-form-field">
                          <span>模型</span>
                          <input
                            value={getRuntimeConfigValue(botDraft.runtimeConfig, 'model')}
                            onChange={(event) => setBotDraft((prev) => ({
                              ...prev,
                              runtimeConfig: {
                                ...prev.runtimeConfig,
                                model: event.target.value,
                              },
                            }))}
                            placeholder="可选，留空则用 Codex 默认"
                          />
                        </label>
                        <label className="bot-form-field">
                          <span>审批策略</span>
                          <select
                            value={getRuntimeConfigValue(botDraft.runtimeConfig, 'approvalPolicy', 'never')}
                            onChange={(event) => setBotDraft((prev) => ({
                              ...prev,
                              runtimeConfig: {
                                ...prev.runtimeConfig,
                                approvalPolicy: event.target.value,
                              },
                            }))}
                          >
                            <option value="never">never</option>
                            <option value="on-request">on-request</option>
                            <option value="on-failure">on-failure</option>
                          </select>
                        </label>
                        <label className="bot-form-field">
                          <span>沙箱</span>
                          <select
                            value={getRuntimeConfigValue(botDraft.runtimeConfig, 'sandbox', 'workspace-write')}
                            onChange={(event) => setBotDraft((prev) => ({
                              ...prev,
                              runtimeConfig: {
                                ...prev.runtimeConfig,
                                sandbox: event.target.value,
                              },
                            }))}
                          >
                            <option value="workspace-write">workspace-write</option>
                            <option value="read-only">read-only</option>
                            <option value="danger-full-access">danger-full-access</option>
                          </select>
                        </label>
                        <label className="bot-form-field">
                          <span>推理强度</span>
                          <select
                            value={getRuntimeConfigValue(botDraft.runtimeConfig, 'effort', 'medium')}
                            onChange={(event) => setBotDraft((prev) => ({
                              ...prev,
                              runtimeConfig: {
                                ...prev.runtimeConfig,
                                effort: event.target.value,
                              },
                            }))}
                          >
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  )}

                  <label className="bot-form-field mt-5">
                    <span>系统提示词</span>
                    <textarea
                      className="min-h-[220px]"
                      value={botDraft.systemPrompt}
                      onChange={(event) => setBotDraft((prev) => ({ ...prev, systemPrompt: event.target.value }))}
                      placeholder="配置这个泡泡机的长期行为"
                    />
                  </label>

                  <div className="mt-6 flex justify-end">
                    <button
                      type="button"
                      className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
                      onClick={() => { void handleSaveBot(); }}
                      disabled={savingBot}
                    >
                      {savingBot ? '保存中...' : '保存泡泡机'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-5">
                <div className="rounded-[30px] border border-black/6 bg-white/90 p-6 shadow-[0_18px_40px_rgba(23,38,28,0.06)]">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-secondary)]">Provider</div>
                  <h3 className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
                    {selectedProviderId === NEW_PROVIDER_ID ? '新建供应商' : (providerDraft.name || '未命名供应商')}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                    这里先按 OpenAI 兼容接口设计。保存新 API Key 时不会回显旧值，留空则保持原状。
                  </p>
                </div>

                <div className="rounded-[30px] border border-black/6 bg-white/90 p-6 shadow-[0_18px_40px_rgba(23,38,28,0.05)]">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="bot-form-field">
                      <span>名称</span>
                      <input
                        value={providerDraft.name}
                        onChange={(event) => setProviderDraft((prev) => ({ ...prev, name: event.target.value }))}
                        placeholder="比如：OpenAI / KIMI / DeepSeek"
                      />
                    </label>
                    <label className="bot-form-field">
                      <span>类型</span>
                      <select
                        value={providerDraft.kind}
                        onChange={(event) => setProviderDraft((prev) => ({ ...prev, kind: event.target.value }))}
                      >
                        <option value="openai-compatible">openai-compatible</option>
                      </select>
                    </label>
                    <label className="bot-form-field">
                      <span>Base URL</span>
                      <input
                        value={providerDraft.baseUrl}
                        onChange={(event) => setProviderDraft((prev) => ({ ...prev, baseUrl: event.target.value }))}
                        placeholder="https://api.example.com/v1"
                      />
                    </label>
                    <label className="bot-form-field">
                      <span>默认模型</span>
                      <input
                        value={providerDraft.defaultModel}
                        onChange={(event) => setProviderDraft((prev) => ({ ...prev, defaultModel: event.target.value }))}
                        placeholder="比如：gpt-4.1-mini"
                      />
                    </label>
                    <label className="bot-form-field">
                      <span>启用状态</span>
                      <select
                        value={providerDraft.enabled ? 'enabled' : 'disabled'}
                        onChange={(event) => setProviderDraft((prev) => ({ ...prev, enabled: event.target.value === 'enabled' }))}
                      >
                        <option value="enabled">已启用</option>
                        <option value="disabled">已停用</option>
                      </select>
                    </label>
                    <label className="bot-form-field">
                      <span>新的 API Key</span>
                      <input
                        type="password"
                        value={providerDraft.apiKey}
                        onChange={(event) => setProviderDraft((prev) => ({
                          ...prev,
                          apiKey: event.target.value,
                          clearApiKey: false,
                        }))}
                        placeholder={providerDraft.hasApiKey ? '已保存，如需更新可重新输入' : '输入后将写入安全存储'}
                      />
                    </label>
                  </div>

                  <div className="mt-4 rounded-[24px] bg-[var(--tool-bg)] px-4 py-4 text-xs leading-6 text-[var(--text-secondary)]">
                    <div>{providerDraft.hasApiKey ? '当前状态：已保存 API Key' : '当前状态：未保存 API Key'}</div>
                    <div>{providerDraft.apiKeyStorage ? `存储位置：${providerDraft.apiKeyStorage}` : '存储位置：安全存储'}</div>
                  </div>

                  {selectedProvider ? (
                    <div className="mt-4 flex justify-start">
                      <button
                        type="button"
                        className="rounded-full bg-black/[0.05] px-4 py-2 text-sm font-semibold text-[var(--text-primary)]"
                        onClick={() => setProviderDraft((prev) => ({
                          ...prev,
                          apiKey: '',
                          clearApiKey: true,
                          hasApiKey: false,
                        }))}
                      >
                        清除已存 API Key
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-6 flex justify-end">
                    <button
                      type="button"
                      className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
                      onClick={() => { void handleSaveProvider(); }}
                      disabled={savingProvider}
                    >
                      {savingProvider ? '保存中...' : '保存供应商'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
