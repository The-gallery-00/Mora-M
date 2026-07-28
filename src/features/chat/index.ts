/**
 * 챗봇 데이터 레이어 (Phase 5) 배럴.
 *
 * 화면(`app/chat.tsx`)은 이 파일만 import 한다.
 *
 * 화면이 반드시 지켜야 하는 계약 3가지:
 *  1. **유형 미선택이면 전송 불가** (FR-077). `canSendChat()` 으로 버튼 상태를 정한다.
 *  2. **취소 버튼 필수** (§3-6). 3홉 왕복이 최대 60초다 — `cancel()` 을 헤더나 입력바에 노출한다.
 *  3. 출처 카드 탭 → SCR-19 이동은 `source.type` + `source.id` 로만 한다.
 *     `DOC_ROUTE_SEGMENT` 를 통과시켜 소문자 세그먼트로 링크를 만든다.
 */

export type { ChatAnswer, ChatDocType, SendChatInput } from './api';
export { CHAT_TIMEOUT_MS, CHAT_TOP_K, sendChatMessage } from './api';

export type { ChatMessage, ChatRole } from './store';
export {
  CHAT_COPY,
  canSendChat,
  chatErrorMessage,
  chatPlaceholder,
  chatRequestFailedMessage,
  useChatStore,
} from './store';
