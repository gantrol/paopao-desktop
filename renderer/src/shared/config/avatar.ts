export const USER_AVATAR = 'https://api.dicebear.com/7.x/avataaars/svg?seed=https://api.dicebear.com/7.x/avataaars/svg?seed=gggg';
export const AI_AVATAR = '/icons/ai_avatar.svg';
export const DEFAULT_STREAM_AVATAR_PRESET = 'bubble';

export type StreamAvatarPreset = {
  id: string;
  label: string;
  gradient: string;
  icon: 'bubble' | 'stream' | 'machine' | 'person';
};

export const STREAM_AVATAR_PRESETS: StreamAvatarPreset[] = [
  { id: 'bubble', label: '泡泡绿', gradient: 'linear-gradient(145deg,#5e9b7a,#76b792)', icon: 'bubble' },
  { id: 'stream', label: '流线蓝', gradient: 'linear-gradient(145deg,#4f7cc9,#76a4ef)', icon: 'stream' },
  { id: 'machine', label: '机器蓝', gradient: 'linear-gradient(145deg,#7294d4,#90a7e4)', icon: 'machine' },
  { id: 'sun', label: '麦芽金', gradient: 'linear-gradient(145deg,#b98b61,#d8ae72)', icon: 'person' },
  { id: 'stone', label: '石墨灰', gradient: 'linear-gradient(145deg,#7d8790,#b5bec8)', icon: 'bubble' },
];
