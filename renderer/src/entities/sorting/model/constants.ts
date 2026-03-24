import type { CSSProperties } from 'react';
import type { Viewport } from '@xyflow/react';
import type { SortingBubbleSourceInfo } from './types';

export const SIDEBAR_PANE_MIN = 164;
export const SIDEBAR_PANE_MAX = 340;
export const SIDEBAR_COLLAPSED_WIDTH = 72;
export const SOURCE_PANE_MIN = 280;
export const SOURCE_PANE_MAX = 520;
export const SOURCE_COLLAPSED_WIDTH = 76;
export const LUGGAGE_PANE_MIN = 220;
export const LUGGAGE_PANE_MAX = 360;
export const LUGGAGE_COLLAPSED_WIDTH = 64;

export const CANVAS_DEFAULT_WIDTH = 280;
export const CANVAS_DEFAULT_HEIGHT = 176;
export const CANVAS_DEFAULT_VIEWPORT: Viewport = { x: 80, y: 56, zoom: 1 };
export const CANVAS_EDGE_COLOR = 'rgba(40, 40, 40, 0.28)';
export const EMPTY_SOURCE_INFO: SortingBubbleSourceInfo = {
  keys: [],
  labels: [],
  originText: '',
  referenceCount: 0,
};

export const FLOW_MULTI_SELECTION_KEYS: string[] = ['Meta', 'Control', 'Shift'];
export const FLOW_FIT_VIEW_OPTIONS = { padding: 0.18 };
export const FLOW_PAN_ON_DRAG_BUTTONS: number[] = [1];
export const FLOW_HANDLE_STYLE: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 9999,
  border: '2px solid rgba(255,255,255,0.96)',
  background: 'rgba(40,40,40,0.4)',
};
