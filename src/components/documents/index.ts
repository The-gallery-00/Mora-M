// src/components/documents/index.ts
//
// 보관함(SCR-14~20) 전용 composite 배럴. 전부 named export 다 — `default export` 금지(§0-2 규칙 1).
// primitive(Chip/Skeleton/TextField 등)는 `@/components/ui` 가 정본이고 여기서 재export 하지 않는다.
export {
  DocumentListItem,
  DocTypeBadge,
  DocPlaceholderIcon,
  docToneOf,
  normalizeDocumentTitle,
} from './DocumentListItem';
export type {
  DocPlaceholderIconProps,
  DocTone,
  DocTypeBadgeProps,
  DocumentListItemProps,
} from './DocumentListItem';

export { DocumentGridCard } from './DocumentGridCard';
export type { DocumentGridCardProps } from './DocumentGridCard';

export { SwipeableRow } from './SwipeableRow';
export type {
  SwipeAction,
  SwipeActionTone,
  SwipeableRowHandle,
  SwipeableRowProps,
} from './SwipeableRow';

export { FieldRow } from './FieldRow';
export type { FieldAction, FieldRowProps } from './FieldRow';

export { SortSheet } from './SortSheet';
export type { SortOption, SortSheetOptions, SortSheetProps } from './SortSheet';

export { GroupChipRail, ALL_GROUP_ID, UNGROUPED_GROUP_ID } from './GroupChipRail';
export type { CardGroupChip, GroupChipRailProps } from './GroupChipRail';

export { DocumentSkeleton } from './DocumentSkeleton';
export type { DocumentSkeletonProps, DocumentSkeletonVariant } from './DocumentSkeleton';
