import type { ReactNode, SVGProps } from 'react';

type StatusGlyphProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

function BaseStatusGlyph({
  size = 14,
  className = '',
  children,
  ...props
}: StatusGlyphProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      {children}
    </svg>
  );
}

export function PinnedStatusGlyph({ size = 14, className = '', ...props }: StatusGlyphProps) {
  return (
    <BaseStatusGlyph size={size} className={className} {...props}>
      <path d="M8 4h8" />
      <path d="M9 4v5l-2 3h10l-2-3V4" />
      <path d="M12 12v8" />
    </BaseStatusGlyph>
  );
}

export function StalledStatusGlyph({ size = 14, className = '', ...props }: StatusGlyphProps) {
  return (
    <BaseStatusGlyph size={size} className={className} {...props}>
      <path d="M12 4.5v15" />
      <path d="M5 12h14" />
      <path d="m7 7 10 10" />
      <path d="M17 7 7 17" />
    </BaseStatusGlyph>
  );
}

export function CurrentStatusGlyph({ size = 14, className = '', ...props }: StatusGlyphProps) {
  return (
    <BaseStatusGlyph size={size} className={className} {...props}>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
    </BaseStatusGlyph>
  );
}

export function SelectedStatusGlyph({ size = 14, className = '', ...props }: StatusGlyphProps) {
  return (
    <BaseStatusGlyph size={size} className={className} {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="m8.8 12.2 2.1 2.2 4.5-4.8" />
    </BaseStatusGlyph>
  );
}
