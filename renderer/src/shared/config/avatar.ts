export const USER_AVATAR = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="24" fill="url(#g)"/>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5B8DEF"/>
      <stop offset="100%" stop-color="#7F56D9"/>
    </linearGradient>
  </defs>
  <text
    x="48"
    y="58"
    text-anchor="middle"
    font-size="38"
    font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, Arial, sans-serif"
    fill="white"
    font-weight="700"
  >你</text>
</svg>
`)}`;
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
