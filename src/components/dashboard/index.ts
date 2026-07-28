// src/components/dashboard/index.ts
//
// 홈 대시보드 · 캘린더 · 알림(SCR-06/07/08) 전용 composite 배럴.
// 전부 named export 다 — `default export` 금지(Component Library §0-2 규칙 1).
// primitive(Button/Skeleton/EmptyState 등)는 `@/components/ui` 가 정본이고 여기서 재export 하지 않는다.
export { DeadlineCard, dDayLabel, DEADLINE_CARD_HEIGHT, DEADLINE_CARD_WIDTH } from './DeadlineCard';
export type { DeadlineCardProps, DeadlineDocType } from './DeadlineCard';

export { StatTile, STAT_TILE_WIDTH } from './StatTile';
export type { StatTileProps, StatTileTone, StatTileVariant } from './StatTile';

export { ScheduleListItem } from './ScheduleListItem';
export type { ScheduleDocType, ScheduleListItemProps } from './ScheduleListItem';

export { NotificationItem } from './NotificationItem';
export type { NotificationItemProps } from './NotificationItem';

export { CalendarLegend, MonthCalendar } from './MonthCalendar';
export type { MonthCalendarProps } from './MonthCalendar';
