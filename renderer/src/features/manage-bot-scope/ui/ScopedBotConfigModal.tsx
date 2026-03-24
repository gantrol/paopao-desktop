import { useEffect, useMemo, useState } from 'react';
import type { BotOutputMode, BotRecord, BotTriggerMode } from '@/entities/bot';
import { StreamAvatar } from '@/shared/ui/StreamAvatar';

type BindingLike = {
  enabled?: boolean;
  triggerMode?: BotTriggerMode;
  outputMode?: BotOutputMode;
  alias?: string;
  metadata?: Record<string, unknown> | null;
} | null | undefined;

export function getDefaultScopedTriggerMode(bot: BotRecord): BotTriggerMode {
  return bot.runtimeType === 'external-codex' ? 'manual' : 'auto';
}

export function getDefaultScopedOutputMode(bot: BotRecord): BotOutputMode {
  return bot.runtimeType === 'external-codex' ? 'thread-comment' : 'stream-reply';
}

export function getScopedBindingConfig(bot: BotRecord, binding: BindingLike) {
  const metadata = binding?.metadata && typeof binding.metadata === 'object' ? binding.metadata : {};
  const scopedConfig = metadata.scopedConfig && typeof metadata.scopedConfig === 'object'
    ? metadata.scopedConfig as Record<string, unknown>
    : {};
  return {
    enabled: binding?.enabled === true,
    triggerMode: binding?.triggerMode || getDefaultScopedTriggerMode(bot),
    outputMode: binding?.outputMode || getDefaultScopedOutputMode(bot),
    alias: typeof binding?.alias === 'string' ? binding.alias : '',
    systemPrompt: typeof scopedConfig.systemPrompt === 'string' ? scopedConfig.systemPrompt : '',
    workspacePath: typeof scopedConfig.workspacePath === 'string' ? scopedConfig.workspacePath : '',
  };
}

export function buildScopedBindingMetadata(
  existingMetadata: Record<string, unknown> | null | undefined,
  overrides: {
    systemPrompt: string;
    workspacePath: string;
  },
) {
  const nextMetadata = existingMetadata && typeof existingMetadata === 'object'
    ? { ...existingMetadata }
    : {};
  const scopedConfig: Record<string, unknown> = {};

  if (overrides.systemPrompt.trim()) {
    scopedConfig.systemPrompt = overrides.systemPrompt.trim();
  }
  if (overrides.workspacePath.trim()) {
    scopedConfig.workspacePath = overrides.workspacePath.trim();
  }

  if (Object.keys(scopedConfig).length > 0) {
    nextMetadata.scopedConfig = scopedConfig;
  } else {
    delete nextMetadata.scopedConfig;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
}

export function ScopedBotConfigModal({
  open,
  bot,
  binding,
  scopeLabel,
  scopeName,
  defaultWorkspacePath,
  onClose,
  onSave,
  onOpenGlobalSettings,
}: {
  open: boolean;
  bot: BotRecord | null;
  binding?: BindingLike;
  scopeLabel: string;
  scopeName: string;
  defaultWorkspacePath?: string;
  onClose: () => void;
  onSave: (payload: {
    enabled: boolean;
    triggerMode: BotTriggerMode;
    outputMode: BotOutputMode;
    alias: string;
    metadata: Record<string, unknown> | null;
  }) => void | Promise<void>;
  onOpenGlobalSettings?: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [triggerMode, setTriggerMode] = useState<BotTriggerMode>('auto');
  const [outputMode, setOutputMode] = useState<BotOutputMode>('stream-reply');
  const [alias, setAlias] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [saving, setSaving] = useState(false);

  const bindingConfig = useMemo(() => (
    bot ? getScopedBindingConfig(bot, binding) : null
  ), [binding, bot]);

  useEffect(() => {
    if (!open || !bot || !bindingConfig) return;
    setEnabled(bindingConfig.enabled);
    setTriggerMode(bindingConfig.triggerMode);
    setOutputMode(bindingConfig.outputMode);
    setAlias(bindingConfig.alias);
    setSystemPrompt(bindingConfig.systemPrompt);
    setWorkspacePath(bindingConfig.workspacePath);
    setSaving(false);
  }, [bindingConfig, bot, open]);

  if (!open || !bot || !bindingConfig) return null;

  const globalWorkspacePath = typeof bot.runtimeConfig?.workspacePath === 'string' && bot.runtimeConfig.workspacePath.trim()
    ? bot.runtimeConfig.workspacePath.trim()
    : (defaultWorkspacePath || '');
  const hasScopedPrompt = Boolean(systemPrompt.trim());
  const hasScopedWorkspacePath = Boolean(workspacePath.trim());

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/55 px-4 py-6 backdrop-blur-sm" onClick={onClose}>
      <section
        className="flex max-h-[calc(100dvh-3rem)] w-[min(92vw,820px)] min-h-0 flex-col overflow-hidden rounded-[30px] bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-black/6 px-6 py-5">
          <div className="flex min-w-0 items-center gap-4">
            {bot.avatarUrl ? (
              <img src={bot.avatarUrl} alt={bot.name} className="h-16 w-16 rounded-[22px] object-cover" />
            ) : (
              <StreamAvatar
                title={bot.name}
                preset={bot.avatarPreset || 'machine'}
                idOffset={`scope-bot-${bot.id}`}
                className="h-16 w-16 rounded-[22px]"
                iconClassName="text-lg font-semibold text-white"
              />
            )}
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-secondary)]">{scopeLabel}</div>
              <h3 className="mt-2 truncate text-2xl font-bold text-[var(--text-primary)]">{bot.name}</h3>
              <div className="mt-2 text-sm text-[var(--text-secondary)]">
                {scopeName}
              </div>
            </div>
          </div>
          <button type="button" className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[14px] bg-black/[0.04] text-lg text-[var(--text-primary)]" onClick={onClose}>×</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-5">
              <div className="rounded-[24px] bg-[var(--tool-bg)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">局域开关</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">仅影响当前范围，优先级高于全局默认。</div>
                  </div>
                  <button
                    type="button"
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${enabled ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--text-secondary)] shadow-sm'}`}
                    onClick={() => setEnabled((prev) => !prev)}
                  >
                    {enabled ? '已启用' : '未启用'}
                  </button>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="bot-form-field">
                    <span>响应时机</span>
                    <select value={triggerMode} onChange={(event) => setTriggerMode(event.target.value as BotTriggerMode)} disabled={!enabled}>
                      <option value="auto">每次发送都算</option>
                      <option value="mention">只有 @ 它</option>
                      <option value="manual">仅手动触发</option>
                    </select>
                  </label>
                  <label className="bot-form-field">
                    <span>响应方式</span>
                    <select value={outputMode} onChange={(event) => setOutputMode(event.target.value as BotOutputMode)} disabled={!enabled}>
                      <option value="stream-reply">直接在流里回复</option>
                      <option value="thread-comment">写到评论线程</option>
                    </select>
                  </label>
                </div>

                <label className="bot-form-field mt-4">
                  <span>局域别名</span>
                  <input
                    value={alias}
                    onChange={(event) => setAlias(event.target.value)}
                    placeholder="可选，用于当前范围内的 @ 和显示名"
                    disabled={!enabled}
                  />
                </label>
              </div>

              <div className="rounded-[24px] bg-[var(--tool-bg)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">系统 Prompt 覆盖</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">留空就继承全局配置；填写后仅当前范围生效。</div>
                  </div>
                  <button
                    type="button"
                    className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] shadow-sm"
                    onClick={() => setSystemPrompt('')}
                    disabled={!hasScopedPrompt}
                  >
                    恢复全局
                  </button>
                </div>
                <label className="bot-form-field mt-4">
                  <span>{hasScopedPrompt ? '当前局域 Prompt' : '当前使用全局 Prompt'}</span>
                  <textarea
                    className="min-h-[220px]"
                    value={systemPrompt}
                    onChange={(event) => setSystemPrompt(event.target.value)}
                    placeholder={bot.systemPrompt || '留空则继续使用全局 prompt'}
                    disabled={!enabled}
                  />
                </label>
              </div>

              {bot.runtimeType === 'external-codex' ? (
                <div className="rounded-[24px] bg-[var(--tool-bg)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">工作区路径覆盖</div>
                      <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Codex 独有配置。留空则继承全局工作区路径。</div>
                    </div>
                    <button
                      type="button"
                      className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] shadow-sm"
                      onClick={() => setWorkspacePath('')}
                      disabled={!hasScopedWorkspacePath}
                    >
                      恢复全局
                    </button>
                  </div>
                  <label className="bot-form-field mt-4">
                    <span>{hasScopedWorkspacePath ? '当前局域路径' : '当前使用全局路径'}</span>
                    <input
                      value={workspacePath}
                      onChange={(event) => setWorkspacePath(event.target.value)}
                      placeholder={globalWorkspacePath || '/absolute/path/to/workspace'}
                      disabled={!enabled}
                    />
                  </label>
                </div>
              ) : null}
            </div>

            <aside className="space-y-4">
              <div className="rounded-[24px] border border-black/6 bg-white p-4">
                <div className="text-sm font-semibold text-[var(--text-primary)]">全局基线</div>
                <div className="mt-3 space-y-3 text-xs leading-6 text-[var(--text-secondary)]">
                  <div>
                    <strong className="block text-[var(--text-primary)]">运行时</strong>
                    <span>{bot.runtimeType === 'external-codex' ? 'Codex 工作机' : 'LLM Bot'}</span>
                  </div>
                  <div>
                    <strong className="block text-[var(--text-primary)]">全局输出默认</strong>
                    <span>{getDefaultScopedOutputMode(bot) === 'stream-reply' ? '直接在流里回复' : '写到评论线程'}</span>
                  </div>
                  <div>
                    <strong className="block text-[var(--text-primary)]">全局触发默认</strong>
                    <span>{getDefaultScopedTriggerMode(bot) === 'auto' ? '每次消息' : '仅手动'}</span>
                  </div>
                  {bot.runtimeType === 'external-codex' ? (
                    <div>
                      <strong className="block text-[var(--text-primary)]">全局工作区</strong>
                      <span className="break-all">{globalWorkspacePath || '未配置'}</span>
                    </div>
                  ) : (
                    <div>
                      <strong className="block text-[var(--text-primary)]">模型 / Provider</strong>
                      <span>{bot.model || bot.providerDefaultModel || '未配置模型'}</span>
                      <br />
                      <span>{bot.providerName || '未配置 Provider'}</span>
                    </div>
                  )}
                  {!bot.enabled ? (
                    <div className="rounded-[18px] bg-[rgba(203,71,71,0.08)] px-3 py-2 text-[#a94c4c]">这个 bot 在全局已停用，局域配置不会真正执行。</div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-[24px] border border-black/6 bg-white p-4">
                <div className="text-sm font-semibold text-[var(--text-primary)]">当前局域结果</div>
                <div className="mt-3 space-y-2 text-xs leading-6 text-[var(--text-secondary)]">
                  <div>{enabled ? '会参与当前范围' : '不会参与当前范围'}</div>
                  <div>{triggerMode === 'auto' ? '每次发送都会判断' : triggerMode === 'mention' ? '只有被 @ 才判断' : '仅手动触发'}</div>
                  <div>{outputMode === 'stream-reply' ? '直接在流里回复' : '写到评论线程'}</div>
                  {alias.trim() ? <div>显示 / @ 别名：{alias.trim()}</div> : null}
                  {hasScopedPrompt ? <div>已覆盖系统 Prompt</div> : <div>系统 Prompt 继承全局</div>}
                  {bot.runtimeType === 'external-codex' ? (
                    <div>{hasScopedWorkspacePath ? '工作区路径已覆盖' : '工作区路径继承全局'}</div>
                  ) : null}
                </div>
              </div>
            </aside>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/6 px-6 py-4">
          <button
            type="button"
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] shadow-sm"
            onClick={() => {
              onOpenGlobalSettings?.();
              onClose();
            }}
          >
            跳转全局设置
          </button>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-full bg-black/[0.05] px-4 py-2 text-sm font-semibold text-[var(--text-primary)]" onClick={onClose}>取消</button>
            <button
              type="button"
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave({
                    enabled,
                    triggerMode,
                    outputMode,
                    alias: alias.trim(),
                    metadata: buildScopedBindingMetadata(binding?.metadata, {
                      systemPrompt,
                      workspacePath,
                    }),
                  });
                  onClose();
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? '保存中...' : '保存局域配置'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
