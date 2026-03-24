import { useEffect, useMemo, useState } from 'react';
import type { BotRecord } from '@/entities/bot';
import type { SortingBoxView } from '@/entities/sorting';
import { InitialAvatar, StreamAvatar } from '@/shared/ui/StreamAvatar';
import {
  getScopedBindingConfig,
  ScopedBotConfigModal,
} from '@/features/manage-bot-scope/ui/ScopedBotConfigModal';

export function SortingBoxSettingsModal({
  open,
  box,
  bots,
  initialBotId,
  defaultWorkspacePath,
  onClose,
  onSaveBotBinding,
  onOpenGlobalBotSettings,
}: {
  open: boolean;
  box: SortingBoxView | null;
  bots: BotRecord[];
  initialBotId?: string | null;
  defaultWorkspacePath?: string;
  onClose: () => void;
  onSaveBotBinding: (botId: string, payload: {
    enabled: boolean;
    triggerMode: 'auto' | 'mention' | 'manual';
    outputMode: 'stream-reply' | 'thread-comment';
    alias: string;
    metadata: Record<string, unknown> | null;
  }) => void | Promise<void>;
  onOpenGlobalBotSettings: () => void;
}) {
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const activeBot = useMemo(
    () => bots.find((item) => item.id === activeBotId) || null,
    [activeBotId, bots],
  );

  useEffect(() => {
    if (!open) return;
    setActiveBotId(initialBotId || null);
  }, [initialBotId, open]);

  if (!open || !box) return null;

  return (
    <div className="fixed inset-0 z-[65] grid place-items-center overflow-y-auto bg-black/50 px-4 py-6 backdrop-blur-sm" onClick={onClose}>
      <section
        className="flex max-h-[calc(100dvh-3rem)] w-[min(92vw,960px)] min-h-0 flex-col overflow-hidden rounded-[30px] bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-black/6 px-6 py-5">
          <div className="flex items-center gap-4">
            <InitialAvatar label={box.name} seed={box.id} tone={box.tone} className="h-16 w-16 rounded-[22px]" textClassName="text-lg font-semibold text-white" />
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-secondary)]">Box Scope</div>
              <h3 className="mt-2 text-2xl font-bold text-[var(--text-primary)]">{box.name}</h3>
              <div className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">{box.description || '当前箱子的局域 Bot / Codex 配置。'}</div>
            </div>
          </div>
          <button type="button" className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[14px] bg-black/[0.04] text-lg text-[var(--text-primary)]" onClick={onClose}>×</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">局域 Bot / Codex</div>
              <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">这组配置只挂在当前箱子上，适合给某个主题箱子指定更贴近当前任务的 prompt、触发时机或 Codex 工作区。</div>
            </div>
            <button
              type="button"
              className="rounded-full bg-[var(--tool-bg)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)]"
              onClick={onOpenGlobalBotSettings}
            >
              去全局设置
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {bots.map((bot) => {
              const binding = box.botBindings?.[bot.id];
              const config = getScopedBindingConfig(bot, binding);
              const hasScopedPrompt = Boolean(config.systemPrompt.trim());
              const hasScopedWorkspacePath = Boolean(config.workspacePath.trim());
              return (
                <button
                  key={bot.id}
                  type="button"
                  className={`rounded-[22px] border px-4 py-4 text-left transition ${config.enabled ? 'border-[var(--accent)]/35 bg-[var(--bubble-me)]/55 shadow-sm' : 'border-black/6 bg-white hover:border-[rgba(42,138,97,0.18)]'}`}
                  onClick={() => setActiveBotId(bot.id)}
                >
                  <div className="flex items-start gap-3">
                    {bot.avatarUrl ? (
                      <img src={bot.avatarUrl} alt={bot.name} className="h-12 w-12 rounded-[18px] object-cover" />
                    ) : (
                      <StreamAvatar
                        title={bot.name}
                        preset={bot.avatarPreset || 'machine'}
                        idOffset={`box-scope-${box.id}-${bot.id}`}
                        className="h-12 w-12 rounded-[18px]"
                        iconClassName="text-base font-semibold text-white"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="truncate text-sm text-[var(--text-primary)]">{bot.name}</strong>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${config.enabled ? 'bg-white text-[var(--accent)]' : 'bg-black/[0.05] text-[var(--text-secondary)]'}`}>
                          {config.enabled ? '箱子启用' : '未启用'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-secondary)]">
                        <span className="rounded-full bg-white px-3 py-1">
                          {config.triggerMode === 'auto' ? '每次消息' : config.triggerMode === 'mention' ? '@ 时触发' : '仅手动'}
                        </span>
                        <span className="rounded-full bg-white px-3 py-1">
                          {config.outputMode === 'stream-reply' ? '直接回复' : '评论'}
                        </span>
                        {hasScopedPrompt ? <span className="rounded-full bg-white px-3 py-1">Prompt 覆盖</span> : null}
                        {hasScopedWorkspacePath ? <span className="rounded-full bg-white px-3 py-1">Workspace 覆盖</span> : null}
                      </div>
                      <div className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                        {bot.runtimeType === 'external-codex' ? 'Codex 工作机' : (bot.introduction || '点击配置这个箱子里的局域行为')}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-black/6 px-6 py-4 text-xs leading-6 text-[var(--text-secondary)]">
          局域配置不会改写工厂里的全局 Bot；这里只是给当前箱子做覆盖层。
        </div>
      </section>

      <ScopedBotConfigModal
        open={Boolean(activeBot)}
        bot={activeBot}
        binding={(activeBot && box.botBindings?.[activeBot.id]) || null}
        scopeLabel="当前箱子"
        scopeName={box.name}
        defaultWorkspacePath={defaultWorkspacePath}
        onClose={() => setActiveBotId(null)}
        onOpenGlobalSettings={onOpenGlobalBotSettings}
        onSave={async (payload) => {
          if (!activeBot) return;
          await onSaveBotBinding(activeBot.id, payload);
        }}
      />
    </div>
  );
}
