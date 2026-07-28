// src/components/search/index.ts
//
// 검색(SCR-23)·챗봇(SCR-24) 전용 composite 배럴. 전부 named export 다 — `default export` 금지(§0-2 규칙 1).
// primitive(Button/Chip/TextField 등)는 `@/components/ui`, 문서 공통 부품(DocTypeBadge 등)은
// `@/components/documents` 가 정본이며 여기서 재export 하지 않는다.
export { SearchBar, SEARCH_BAR_PLACEHOLDER } from './SearchBar';
export type { SearchBarProps } from './SearchBar';

export { SearchResultCard, HighlightedText, searchFactsOf } from './SearchResultCard';
export type { SearchFact, SearchResultCardProps } from './SearchResultCard';

export { RecentQueryList } from './RecentQueryList';
export type { RecentQueryListProps } from './RecentQueryList';

export { SourceCard, SOURCE_CARD_HEIGHT, SOURCE_CARD_WIDTH } from './SourceCard';
export type { SourceCardProps } from './SourceCard';

export { ChatBubble, TypingBubble } from './ChatBubble';
export type { ChatBubbleProps } from './ChatBubble';

export { ChatComposer } from './ChatComposer';
export type { ChatComposerProps } from './ChatComposer';

export { ChatFab } from './ChatFab';
export type { ChatFabProps } from './ChatFab';
