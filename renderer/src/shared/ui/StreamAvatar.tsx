import type { CSSProperties } from 'react';
import { STREAM_AVATAR_PRESETS } from '@/shared/config/avatar';
import { normalizeAvatarPreset } from '@/shared/lib/avatar';

const INITIAL_AVATAR_PALETTES = [
  { background: 'linear-gradient(145deg,#5e9b7a,#7ab792)', color: '#ffffff' },
  { background: 'linear-gradient(145deg,#4f7cc9,#76a4ef)', color: '#ffffff' },
  { background: 'linear-gradient(145deg,#b98b61,#d8ae72)', color: '#ffffff' },
  { background: 'linear-gradient(145deg,#7d8790,#b5bec8)', color: '#ffffff' },
  { background: 'linear-gradient(145deg,#8b7ab7,#b7aad7)', color: '#ffffff' },
  { background: 'linear-gradient(145deg,#bf7b70,#dda197)', color: '#ffffff' },
];

function getAvatarPreset(value?: string) {
  return STREAM_AVATAR_PRESETS.find((preset) => preset.id === normalizeAvatarPreset(value)) || STREAM_AVATAR_PRESETS[0];
}

function hashSeed(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getAvatarInitial(label?: string) {
  const normalized = typeof label === 'string' ? label.trim() : '';
  if (!normalized) return '?';
  const chars = Array.from(normalized);
  const meaningfulChar = chars.find((char) => /[\p{L}\p{N}]/u.test(char)) || chars[0];
  if (!meaningfulChar) return '?';
  return /^[a-z]$/i.test(meaningfulChar) ? meaningfulChar.toUpperCase() : meaningfulChar;
}

function getInitialAvatarStyle(seed: string, options?: { gradient?: string; tone?: string }) {
  if (options?.gradient) {
    return {
      background: options.gradient,
      color: '#ffffff',
    };
  }
  if (options?.tone) {
    return {
      background: options.tone,
      color: '#ffffff',
    };
  }
  return INITIAL_AVATAR_PALETTES[hashSeed(seed) % INITIAL_AVATAR_PALETTES.length];
}

export function InitialAvatar({
  label,
  seed,
  gradient,
  tone,
  className = 'h-12 w-12 rounded-2xl',
  textClassName = 'text-base font-semibold text-white',
  style,
}: {
  label?: string;
  seed?: string;
  gradient?: string;
  tone?: string;
  className?: string;
  textClassName?: string;
  style?: CSSProperties;
}) {
  const initial = getAvatarInitial(label);
  const avatarStyle = getInitialAvatarStyle(seed || label || initial, { gradient, tone });

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden ${className}`}
      style={{ ...avatarStyle, ...style }}
      aria-hidden="true"
    >
      <span className={textClassName}>{initial}</span>
    </div>
  );
}

export function StreamAvatar({
  title,
  preset,
  idOffset,
  className = 'h-12 w-12 rounded-2xl',
  iconClassName = 'text-base font-semibold text-white',
}: {
  title?: string;
  preset?: string;
  idOffset?: string;
  className?: string;
  iconClassName?: string;
}) {
  const avatarPreset = getAvatarPreset(preset);

  return (
    <InitialAvatar
      label={title}
      seed={idOffset || title || avatarPreset.id}
      gradient={avatarPreset.gradient}
      className={className}
      textClassName={iconClassName}
    />
  );
}

export function renderChannelAvatar(
  channel: { avatarUrl?: string; avatarPreset?: string; avatar: string; id: string; title?: string },
  className: string,
  iconClassName = 'text-base font-semibold text-white',
) {
  if (channel.avatarUrl) {
    return <img src={channel.avatarUrl} alt="avatar" className={`${className} object-cover`} />;
  }
  return (
    <StreamAvatar
      title={channel.title}
      preset={channel.avatarPreset || channel.avatar}
      idOffset={channel.id}
      className={className}
      iconClassName={iconClassName}
    />
  );
}
