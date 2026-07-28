// src/components/ui/index.ts
//
// 공통 UI 프리미티브 배럴. Phase 2·3 에서 실제로 소비되는 것만 있다
// (52종 전부를 미리 만들지 않는다 — Component Library §0-4 규칙 A).
//
// 전부 named export 다. `default export` 는 금지(§0-2 규칙 1).
export { Button } from './Button';
export type { ButtonHaptic, ButtonProps, ButtonSize, ButtonVariant } from './Button';

export { IconButton } from './IconButton';
export type {
  IconButtonProps,
  IconButtonSize,
  IconButtonTone,
  IconButtonVariant,
} from './IconButton';

export { TextField } from './TextField';
export type { TextFieldProps, TextFieldVariant } from './TextField';

export { Divider } from './Divider';
export type { DividerOrientation, DividerProps, DividerTone } from './Divider';

export { Chip } from './Chip';
export type { ChipDocTone, ChipProps, ChipSize, ChipTone } from './Chip';

export { SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps, SegmentedOption } from './SegmentedControl';

export { ProgressBar } from './ProgressBar';
export type { ProgressBarProps, ProgressTone } from './ProgressBar';

export { Skeleton } from './Skeleton';
export type { SkeletonProps } from './Skeleton';

// ToastHost 는 루트(app/_layout.tsx)에 1개만 마운트한다 — 마운트는 셸 담당의 몫이다.
export { ToastHost } from './Toast';
export type { ToastHostProps } from './Toast';
export { toast, useToastStore } from './toastStore';
export type { ToastItem, ToastOptions, ToastTone } from './toastStore';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
