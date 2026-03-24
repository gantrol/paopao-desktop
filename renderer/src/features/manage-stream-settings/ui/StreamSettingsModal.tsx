import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import type { BotRecord } from '@/entities/bot';
import { PinnedStatusGlyph, StalledStatusGlyph } from '@/shared/icons/StatusGlyph';
import { uploadFile } from '@/shared/lib/upload';
import type { ChatChannel, ChatLifecycleStatus } from '@/entities/conversation';
import type { UserProfileRecord } from '@/entities/user';
import {
  getConversationContextMetadata,
} from '@/entities/conversation';
import {
  listBots,
  saveConversationBotBinding,
} from '@/shared/api/desktop/chat';
import { STREAM_AVATAR_PRESETS, USER_AVATAR } from '@/shared/config/avatar';
import { getUserAvatarSrc, normalizeAvatarPreset } from '@/shared/lib/avatar';
import { getErrorMessage } from '@/shared/lib/error';
import {
  getScopedBindingConfig,
  ScopedBotConfigModal,
} from '@/features/manage-bot-scope/ui/ScopedBotConfigModal';
import { StreamAvatar } from '@/shared/ui/StreamAvatar';

export function StreamSettingsModal({
  open,
  channel,
  userProfile,
  onClose,
  onSaveBasics,
  onSaveUserAvatar,
  onClearMessages,
  onTogglePinned,
  onToggleFolded,
  onSetLifecycleStatus,
  defaultWorkspacePath,
  onOpenGlobalBotSettings,
}: {
  open: boolean;
  channel: ChatChannel | null;
  userProfile: UserProfileRecord;
  onClose: () => void;
  onSaveBasics: (payload: { title: string; avatarPreset: string; avatarUrl: string }) => void | Promise<void>;
  onSaveUserAvatar: (payload: { avatarUrl: string }) => void | Promise<void>;
  onClearMessages: () => void | Promise<void>;
  onTogglePinned: () => void | Promise<void>;
  onToggleFolded: () => void | Promise<void>;
  onSetLifecycleStatus: (status: ChatLifecycleStatus) => void | Promise<void>;
  defaultWorkspacePath?: string;
  onOpenGlobalBotSettings: () => void;
}) {
  const [title, setTitle] = useState(channel?.title || '');
  const [avatarPreset, setAvatarPreset] = useState(normalizeAvatarPreset(channel?.avatarPreset || channel?.avatar));
  const [avatarUrl, setAvatarUrl] = useState(channel?.avatarUrl || '');
  const [avatarHint, setAvatarHint] = useState('');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [userAvatarUrl, setUserAvatarUrl] = useState(getUserAvatarSrc(userProfile));
  const [userAvatarHint, setUserAvatarHint] = useState('');
  const [isUploadingUserAvatar, setIsUploadingUserAvatar] = useState(false);
  const [scopedBots, setScopedBots] = useState<BotRecord[]>([]);
  const [isLoadingScopedBots, setIsLoadingScopedBots] = useState(false);
  const [activeScopedBotId, setActiveScopedBotId] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const userAvatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || !channel) return;
    setTitle(channel.title || '');
    setAvatarPreset(normalizeAvatarPreset(channel.avatarPreset || channel.avatar));
    setAvatarUrl(channel.avatarUrl || '');
    setAvatarHint('');
    setUserAvatarUrl(getUserAvatarSrc(userProfile));
    setUserAvatarHint('');
  }, [channel, open, userProfile]);

  useEffect(() => {
    if (!open || !channel) return;
    let cancelled = false;
    setIsLoadingScopedBots(true);
    void listBots({ conversationId: channel.id })
      .then((items) => {
        if (cancelled) return;
        setScopedBots(items);
      })
      .catch(() => {
        if (cancelled) return;
        setScopedBots([]);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingScopedBots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channel, open]);

  useEffect(() => {
    if (!open) {
      setAvatarHint('');
      setUserAvatarHint('');
      setActiveScopedBotId(null);
    }
  }, [channel, open]);

  if (!open || !channel) return null;

  const contextMetadata = getConversationContextMetadata(channel.metadata);
  const isDirectConversation = Boolean(contextMetadata.directBotId || contextMetadata.conversationMode === 'direct-bot');
  const directConversationName = contextMetadata.directBotName || channel.title;
  const isArchived = channel.lifecycleStatus === 'archived';
  const isDeleted = channel.lifecycleStatus === 'deleted';
  const isFlowing = !isArchived && !isDeleted;
  const hasMessages = channel.messages.length > 0;
  const activeScopedBot = scopedBots.find((item) => item.id === activeScopedBotId) || null;

  const handleConversationAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setAvatarHint('头像文件必须是图片');
      return;
    }
    try {
      setIsUploadingAvatar(true);
      const uploadedAvatarUrl = await uploadFile(file);
      setAvatarUrl(uploadedAvatarUrl);
      setAvatarHint('头像已上传，记得保存泡泡流');
    } catch (error) {
      setAvatarHint(`头像上传失败：${getErrorMessage(error)}`);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleUserAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUserAvatarHint('头像文件必须是图片');
      return;
    }
    try {
      setIsUploadingUserAvatar(true);
      const uploadedAvatarUrl = await uploadFile(file);
      setUserAvatarUrl(uploadedAvatarUrl);
      setUserAvatarHint('我的头像已上传，保存后会全局同步到旧话题');
    } catch (error) {
      setUserAvatarHint(`头像上传失败：${getErrorMessage(error)}`);
    } finally {
      setIsUploadingUserAvatar(false);
    }
  };

  const refreshScopedBots = async () => {
    if (!channel) return;
    setIsLoadingScopedBots(true);
    try {
      const items = await listBots({ conversationId: channel.id });
      setScopedBots(items);
    } finally {
      setIsLoadingScopedBots(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 px-4 py-6 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[calc(100dvh-3rem)] w-[min(94vw,980px)] overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              <img src={avatarUrl} alt={channel.title} className="h-14 w-14 rounded-[20px] object-cover" />
            ) : (
              <StreamAvatar title={title} preset={avatarPreset} idOffset={channel.id} className="h-14 w-14 rounded-[20px]" iconClassName="text-xl font-semibold text-white" />
            )}
            <div>
              <span className="text-[11px] uppercase tracking-[0.28em] text-[var(--text-secondary)]">Bubble Stream</span>
              <h3 className="mt-2 text-2xl font-bold text-[var(--text-primary)]">流设置</h3>
            </div>
          </div>
          <button type="button" className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[14px] bg-white/90 shadow-sm transition-all duration-200 hover:-translate-y-px" onClick={onClose}>×</button>
        </div>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-5">
            <div className="rounded-[24px] bg-[var(--tool-bg)] p-4">
              <label className="mb-4 flex flex-col gap-2">
                <span className="text-sm font-medium text-[var(--text-secondary)]">流名称</span>
                <input
                  className="w-full rounded-2xl border border-black/8 bg-white px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="为这个泡泡流命名"
                />
              </label>

              <div className="rounded-[20px] border border-black/8 bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[var(--text-secondary)]">{isDirectConversation ? '私聊头像' : '上传头像'}</span>
                    <span className="mt-1 block break-all text-xs leading-5 text-[var(--text-secondary)]">
                      {isDirectConversation
                        ? `这条私聊会跟随 ${directConversationName} 的头像，这里仅展示当前同步结果。`
                        : '上传图片后会优先用于会话列表和消息流头像；不上传时继续使用下面的内置头像。'}
                    </span>
                  </div>
                  {isDirectConversation ? null : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-full bg-black/[0.05] px-4 py-2 text-sm font-semibold text-[var(--text-primary)]"
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={isUploadingAvatar}
                      >
                        {isUploadingAvatar ? '上传中...' : (avatarUrl ? '更换头像' : '上传头像')}
                      </button>
                      {avatarUrl ? (
                        <button
                          type="button"
                          className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] shadow-sm"
                          onClick={() => {
                            setAvatarUrl('');
                            setAvatarHint('已清除上传头像，保存后会回退到内置头像');
                          }}
                        >
                          清除图片
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
                {avatarHint ? (
                  <div className="mt-3 break-all text-xs text-[var(--text-secondary)]">{avatarHint}</div>
                ) : null}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => { void handleConversationAvatarChange(event); }}
              />

              <div>
                <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">内置头像</span>
                <div className="grid grid-cols-5 gap-3">
                  {STREAM_AVATAR_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`rounded-[18px] border p-2 transition ${avatarPreset === preset.id ? 'border-[var(--accent)] bg-[var(--bubble-me)]' : 'border-black/8 bg-white'}`}
                      onClick={() => setAvatarPreset(preset.id)}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <StreamAvatar title={title} preset={preset.id} idOffset={`${channel.id}-${preset.id}`} className="h-11 w-11 rounded-2xl" iconClassName="text-base font-semibold text-white" />
                        <span className="text-[11px] font-medium text-[var(--text-secondary)]">{preset.label}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                  onClick={() => { void onSaveBasics({ title, avatarPreset, avatarUrl }); }}
                >
                  保存基础信息
                </button>
              </div>
            </div>

            <div className="rounded-[24px] bg-[var(--tool-bg)] p-4">
              <div className="mb-4 flex items-center gap-4">
                <img src={userAvatarUrl} alt="我的头像" className="h-14 w-14 rounded-[20px] object-cover" />
                <div>
                  <div className="text-sm font-medium text-[var(--text-secondary)]">我的头像（全局）</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">保存后会同步更新所有旧话题里“我”的头像，不再依赖历史快照。</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-full bg-black/[0.05] px-4 py-2 text-sm font-semibold text-[var(--text-primary)]"
                  onClick={() => userAvatarInputRef.current?.click()}
                  disabled={isUploadingUserAvatar}
                >
                  {isUploadingUserAvatar ? '上传中...' : '上传我的头像'}
                </button>
                <button
                  type="button"
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] shadow-sm"
                  onClick={() => {
                    setUserAvatarUrl(USER_AVATAR);
                    setUserAvatarHint('已恢复默认头像，保存后会全局生效');
                  }}
                >
                  恢复默认
                </button>
              </div>
              {userAvatarHint ? (
                <div className="mt-3 break-all text-xs text-[var(--text-secondary)]">{userAvatarHint}</div>
              ) : null}
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                  onClick={() => { void onSaveUserAvatar({ avatarUrl: userAvatarUrl }); }}
                >
                  保存我的头像
                </button>
              </div>
              <input
                ref={userAvatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => { void handleUserAvatarChange(event); }}
              />
            </div>

            <div className="rounded-[24px] bg-[var(--tool-bg)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">局域 Bot / Codex</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">仅对当前泡泡流生效，可覆盖全局的触发时机、输出方式、系统 prompt，以及 Codex 的工作区路径。</div>
                </div>
                <button
                  type="button"
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] shadow-sm"
                  onClick={onOpenGlobalBotSettings}
                >
                  去全局设置
                </button>
              </div>

              <div className="mt-4">
                {isLoadingScopedBots ? (
                  <div className="rounded-[20px] bg-white px-4 py-4 text-sm text-[var(--text-secondary)]">正在加载局域配置...</div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {scopedBots.map((bot) => {
                      const config = getScopedBindingConfig(bot, bot.binding);
                      const hasScopedPrompt = Boolean(config.systemPrompt.trim());
                      const hasScopedWorkspacePath = Boolean(config.workspacePath.trim());
                      return (
                        <button
                          key={bot.id}
                          type="button"
                          className={`rounded-[22px] border px-4 py-4 text-left transition ${config.enabled ? 'border-[var(--accent)]/35 bg-white shadow-sm' : 'border-black/6 bg-white/80 hover:border-[rgba(42,138,97,0.18)]'}`}
                          onClick={() => setActiveScopedBotId(bot.id)}
                        >
                          <div className="flex items-start gap-3">
                            {bot.avatarUrl ? (
                              <img src={bot.avatarUrl} alt={bot.name} className="h-12 w-12 rounded-[18px] object-cover" />
                            ) : (
                              <StreamAvatar
                                title={bot.name}
                                preset={bot.avatarPreset || 'machine'}
                                idOffset={`stream-scope-${channel.id}-${bot.id}`}
                                className="h-12 w-12 rounded-[18px]"
                                iconClassName="text-base font-semibold text-white"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <strong className="truncate text-sm text-[var(--text-primary)]">{bot.name}</strong>
                                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${config.enabled ? 'bg-[var(--bubble-me)] text-[var(--accent)]' : 'bg-black/[0.05] text-[var(--text-secondary)]'}`}>
                                  {config.enabled ? '局域启用' : '未启用'}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-secondary)]">
                                <span className="rounded-full bg-[var(--tool-bg)] px-3 py-1">
                                  {config.triggerMode === 'auto' ? '每次消息' : config.triggerMode === 'mention' ? '@ 时触发' : '仅手动'}
                                </span>
                                <span className="rounded-full bg-[var(--tool-bg)] px-3 py-1">
                                  {config.outputMode === 'stream-reply' ? '直接回复' : '评论'}
                                </span>
                                {hasScopedPrompt ? <span className="rounded-full bg-[var(--tool-bg)] px-3 py-1">Prompt 覆盖</span> : null}
                                {hasScopedWorkspacePath ? <span className="rounded-full bg-[var(--tool-bg)] px-3 py-1">Workspace 覆盖</span> : null}
                              </div>
                              <div className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                                {bot.runtimeType === 'external-codex' ? 'Codex 工作机' : (bot.introduction || '点击配置这条流里的局域行为')}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

          </div>

          <div className="space-y-4 rounded-[24px] bg-[var(--tool-bg)] p-4">
            <div>
              <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">状态</div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--text-primary)]">
                  {isDeleted ? '最近删除' : isArchived ? '归档' : '流动'}
                </span>
                {channel.isPinned ? (
                  <span className="status-chip status-chip--sm status-chip--accent" title="置顶" aria-label="置顶">
                    <PinnedStatusGlyph size={12} />
                  </span>
                ) : null}
                {channel.isFolded ? <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--accent)]">已折叠</span> : null}
                {channel.isStalled ? (
                  <span className="status-chip status-chip--sm" title="停滞 7 天+" aria-label="停滞 7 天+">
                    <StalledStatusGlyph size={12} />
                  </span>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold ${isFlowing ? 'bg-white text-[var(--text-primary)]' : 'cursor-not-allowed bg-white/70 text-[var(--text-secondary)]'}`}
                onClick={() => { if (isFlowing) void onTogglePinned(); }}
              >
                {channel.isPinned ? '取消置顶' : '置顶到主列表顶部'}
              </button>
              <button
                type="button"
                className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold ${isFlowing ? 'bg-white text-[var(--text-primary)]' : 'cursor-not-allowed bg-white/70 text-[var(--text-secondary)]'}`}
                onClick={() => { if (isFlowing) void onToggleFolded(); }}
              >
                {channel.isFolded ? '取消折叠' : '移动到泡泡折叠空间'}
              </button>
              <button
                type="button"
                className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold ${hasMessages ? 'bg-white text-[var(--text-primary)]' : 'cursor-not-allowed bg-white/70 text-[var(--text-secondary)]'}`}
                onClick={() => { if (hasMessages) void onClearMessages(); }}
              >
                清空聊天记录
              </button>
              {isFlowing ? (
                <button type="button" className="w-full rounded-2xl bg-white px-4 py-3 text-left text-sm font-semibold text-[var(--text-primary)]" onClick={() => { void onSetLifecycleStatus('archived'); }}>
                  归档
                </button>
              ) : isArchived ? (
                <button type="button" className="w-full rounded-2xl bg-white px-4 py-3 text-left text-sm font-semibold text-[var(--text-primary)]" onClick={() => { void onSetLifecycleStatus('flowing'); }}>
                  恢复到流动
                </button>
              ) : null}
              {isDeleted ? (
                <button type="button" className="w-full rounded-2xl bg-white px-4 py-3 text-left text-sm font-semibold text-[var(--accent)]" onClick={() => { void onSetLifecycleStatus('flowing'); }}>
                  从最近删除恢复
                </button>
              ) : (
                <button type="button" className="w-full rounded-2xl bg-[#fff4f4] px-4 py-3 text-left text-sm font-semibold text-[#c55454]" onClick={() => { void onSetLifecycleStatus('deleted'); }}>
                  移到最近删除
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ScopedBotConfigModal
        open={Boolean(activeScopedBot)}
        bot={activeScopedBot}
        binding={activeScopedBot?.binding || null}
        scopeLabel="当前泡泡流"
        scopeName={channel.title || '当前泡泡流'}
        defaultWorkspacePath={defaultWorkspacePath}
        onClose={() => setActiveScopedBotId(null)}
        onOpenGlobalSettings={onOpenGlobalBotSettings}
        onSave={async (payload) => {
          if (!activeScopedBot) return;
          await saveConversationBotBinding({
            conversationId: channel.id,
            botId: activeScopedBot.id,
            enabled: payload.enabled,
            triggerMode: payload.triggerMode,
            outputMode: payload.outputMode,
            alias: payload.alias,
            metadata: payload.metadata,
          });
          await refreshScopedBots();
        }}
      />
    </div>
  );
}
