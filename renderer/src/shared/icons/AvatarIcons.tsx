import { useId, type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

export const BubbleIcon = ({ idOffset, ...props }: IconProps & { idOffset?: string }) => {
  const reactId = useId();
  const maskId = `bubble-mask-${idOffset || reactId}`;
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <mask id={maskId}>
        <rect width="24" height="24" fill="white" />
        <circle cx="8" cy="8" r="2.5" fill="black" />
      </mask>
      <circle cx="12" cy="12" r="10" mask={`url(#${maskId})`} />
    </svg>
  );
};

export const StreamIcon = ({ idOffset, ...props }: IconProps & { idOffset?: string }) => {
  const reactId = useId();
  const maskId = `stream-mask-${idOffset || reactId}`;
  const gradientId = `stream-grad-${idOffset || reactId}`;
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <mask id={maskId}>
        <rect width="24" height="24" fill="white" />
        <circle cx="5.5" cy="5.5" r="1.5" fill="black" />
      </mask>
      <circle cx="8" cy="8" r="6" fill="currentColor" mask={`url(#${maskId})`} />
      <path d="M 3 21 C 13 19, 9 7, 21 5" stroke={`url(#${gradientId})`} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M 8 22 C 16 20, 14 11, 22 9" stroke={`url(#${gradientId})`} strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
};

export const SortingIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M21 9H3V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3Zm-2 2H5v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9Z" opacity="0.4" />
    <path d="M19 11H5v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9Zm-4 4H9v-2h6v2Z" />
    <circle cx="15.5" cy="5.5" r="2.5" />
    <circle cx="10" cy="3" r="1.5" />
    <circle cx="8" cy="6" r="1.5" />
  </svg>
);

export const BubbleMachineIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <circle cx="11" cy="6" r="3" />
    <circle cx="16" cy="11" r="2" />
    <circle cx="7" cy="11" r="1.5" />
    <rect x="5" y="15" width="14" height="7" rx="2" />
  </svg>
);

export const YouIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 12A5 5 0 1 0 12 2A5 5 0 0 0 12 12Z" />
    <path d="M12 14c-4.42 0-8 2.24-8 5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-2.76-3.58-5-8-5Z" />
  </svg>
);

export const CompoundBubbleIcon = (props: IconProps) => {
  const reactId = useId();
  const grad1 = `compound-grad-1-${reactId}`;
  const grad2 = `compound-grad-2-${reactId}`;
  const grad3 = `compound-grad-3-${reactId}`;
  return (
    <svg viewBox="0 0 28 28" fill="none" {...props}>
      <defs>
        <radialGradient id={grad1} cx="50%" cy="50%" r="50%" fx="30%" fy="30%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.9} />
          <stop offset="100%" stopColor="#4facfe" stopOpacity={0.8} />
        </radialGradient>
        <radialGradient id={grad2} cx="50%" cy="50%" r="50%" fx="30%" fy="30%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.9} />
          <stop offset="100%" stopColor="#ff9a9e" stopOpacity={0.8} />
        </radialGradient>
        <radialGradient id={grad3} cx="50%" cy="50%" r="50%" fx="30%" fy="30%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.9} />
          <stop offset="100%" stopColor="#a18cd1" stopOpacity={0.8} />
        </radialGradient>
      </defs>
      <circle cx="9" cy="18" r="6" fill={`url(#${grad1})`} stroke="rgba(255,255,255,0.5)" strokeWidth="0.5" />
      <circle cx="19" cy="14" r="5" fill={`url(#${grad2})`} stroke="rgba(255,255,255,0.5)" strokeWidth="0.5" />
      <circle cx="14" cy="8" r="4" fill={`url(#${grad3})`} stroke="rgba(255,255,255,0.5)" strokeWidth="0.5" />
    </svg>
  );
};
