import type { CSSProperties } from 'react';

export function BoxIcon({ size = 16, className = '', style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

export function MessageCircleIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

export function HashIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </svg>
  );
}

export function TrashIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

export function CopyIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <rect width="14" height="14" x="8" y="8" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function EditIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function EyeIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function TodoIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.8 12 2.2 2.2 4.6-4.6" />
    </svg>
  );
}

export function PlusIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
      <line x1="12" x2="12" y1="5" y2="19" />
      <line x1="5" x2="19" y1="12" y2="12" />
    </svg>
  );
}

export function GripIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
      <circle cx="9" cy="6" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="18" r="1" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function SuitcaseIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M6 7V5h12v2" />
      <path d="M4 7h16v13H4z" />
      <path d="M10 12h4" />
      <path d="M8 7v13" />
      <path d="M16 7v13" />
    </svg>
  );
}

export function UploadIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function TableIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M3 10h18" />
      <path d="M9 4v16" />
      <path d="M15 4v16" />
    </svg>
  );
}

export function PanelLeftIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

export function TextIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  );
}

export function LinkIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.7 5.23" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 1 0 7.07 7.07l1.41-1.41" />
    </svg>
  );
}

export function ImageIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m21 16-5.5-5.5L6 20" />
    </svg>
  );
}

export function FileIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Z" />
      <path d="M14 2v7h7" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

export function MicIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
    </svg>
  );
}

export function SendIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M3 11.5 21 3l-5.2 18-3.7-6.1L3 11.5Z" />
      <path d="M11.8 14.7 21 3" />
    </svg>
  );
}

export function ArrowUpIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
      <path d="m6 11 6-6 6 6" />
      <path d="M12 19V6" />
    </svg>
  );
}

export function ArrowDownIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
      <path d="m18 13-6 6-6-6" />
      <path d="M12 5v13" />
    </svg>
  );
}

export function XIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function ExpandIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M9 3H3v6" />
      <path d="m3 3 7 7" />
      <path d="M15 3h6v6" />
      <path d="m21 3-7 7" />
      <path d="M9 21H3v-6" />
      <path d="m3 21 7-7" />
      <path d="M15 21h6v-6" />
      <path d="m21 21-7-7" />
    </svg>
  );
}

export function MinimizeIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M9 9H4V4" />
      <path d="m4 4 6 6" />
      <path d="M15 9h5V4" />
      <path d="m20 4-6 6" />
      <path d="M9 15H4v5" />
      <path d="m4 20 6-6" />
      <path d="M15 15h5v5" />
      <path d="m20 20-6-6" />
    </svg>
  );
}
