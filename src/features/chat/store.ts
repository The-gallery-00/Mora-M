/**
 * 챗봇 대화 상태 (SCR-24 · FR-076~FR-080).
 *
 * 정본: wiki/design/Screen Specs.md SCR-24 (문구 전량 원문 보존)
 *       wiki/tech/API Contract.md §3-6 · §6-2(`['chat',sessionId]` 는 캐시 대상 아님)
 *
 * ─────────────────────────── React Query 를 쓰지 않는 이유 ───────────────────────────
 *
 * 서버에 대화 저장이 없다. `/api/chat` 은 순수 요청/응답이고 조회 엔드포인트도, 세션 개념도 없다.
 * 캐시할 서버 상태가 존재하지 않으므로 대화는 **메모리 전용 zustand 스토어**다 (원본 웹과 동일).
 * persist 도 걸지 않는다 — 앱 종료 시 소멸이 원본 동작이고, 대화에는 문서 내용이 그대로 인용되어
 * 평문 MMKV 에 남기면 PII 가 늘어난다.
 *
 * ─────────────────────────── 취소 처리 ───────────────────────────
 *
 * 3홉(앱→Spring→LLM→Spring→DB) 구조라 응답이 늦게 오고, 중간 httpx 타임아웃이 10초라
 * 실패도 늦게 드러난다. §3-6 이 "타임아웃 60초 + 취소 버튼 필수"를 요구하는 이유다.
 * 진행 중 요청은 모듈 스코프 `AbortController` 하나로 관리하고, **응답이 돌아왔을 때
 * 그 컨트롤러가 여전히 현재 요청인지 확인**한 뒤에만 메시지를 붙인다. 취소 후 늦게 도착한
 * 답변이 새 대화에 끼어드는 것을 막는 유일한 방법이다.
 */

import { create } from 'zustand';

import type { DocumentSummary } from '@/features/documents';
import type { AppError } from '@/services/http';

import { CHAT_TOP_K, sendChatMessage, type ChatDocType } from './api';

// ───────────────────────────────────────────────────────────── 문구

/**
 * SCR-24 "문구 원문 (전량 보존)" 표 그대로. **한 글자도 바꾸지 않는다.**
 * 원본 `ChatbotWidget.tsx` 에서 계승된 카피이며 여기서 새로 짓는 문장은 없다.
 */
export const CHAT_COPY = {
  title: 'AI 모라냥',
  greeting:
    '안녕하세요. MORA 챗봇 AI 모라냥입니다. 업로드, 검색, 일정 등록 관련해서 무엇이든 물어보세요.',
  typing: '답변 작성 중...',
  /** 서버가 답변을 비워 보낸 경우의 폴백. 검색 0건 문구와 다른 상황이다. */
  emptyAnswer: '관련 문서를 찾았지만 답변 내용이 비어 있어요.',
  /** 검색 0건 시 서버(LLM)가 주는 고정 답변. 앱이 만들지 않는다 — 비교/검증용 상수다. */
  noResult: '관련된 데이터를 찾을 수 없어 답변하기 어렵습니다. 다른 키워드로 검색해 보세요.',
  send: '전송',
  retry: '다시 시도',
  sessionExpired: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',
  networkFailed: '백엔드 서버에 연결할 수 없습니다.',
  timeout: '답변이 오래 걸립니다. 잠시 후 다시 시도해 주세요.',
  sourceNotFound: '문서를 찾을 수 없습니다.',
  copied: '복사했습니다.',
  help: {
    title: 'AI 모라냥 이용 안내',
    confirm: '확인',
    items: [
      '키워드만 입력하기보다 대화형 문장으로 질문해 주세요.',
      '저는 MORA의 문서 관리 기능(업로드, OCR, 보관함, 검색) 중심으로 안내해 드려요.',
      '실제 문서 인식 결과는 이미지 품질에 따라 달라질 수 있으니 저장 전 필드 값을 꼭 확인해 주세요.',
      '일정/연락처/금액 같은 중요 정보는 원본 이미지와 함께 최종 검토하는 것을 권장해요.',
      '입력한 대화 내용은 품질 개선과 오류 분석을 위해 서비스 정책에 따라 처리될 수 있어요.',
    ],
  },
  reset: {
    title: '대화 내용 초기화',
    body: '대화가 처음부터 다시 시작되며 이전 대화 내용은 복구할 수 없습니다. 초기화 하시겠습니까?',
    confirm: '초기화',
    cancel: '취소',
  },
} as const;

/** 호출 실패 문구 — 원본 웹과 동일한 형태(`(${status})`). */
export const chatRequestFailedMessage = (status: number | null): string =>
  `챗봇 답변을 불러오지 못했습니다. (${status ?? 0})`;

/**
 * 유형별 입력창 placeholder (FR-077). 미선택이면 전송 자체가 막힌다.
 * 문구는 SCR-24 표 원문이다.
 */
const PLACEHOLDERS: Record<ChatDocType, string> = {
  BUSINESS_CARD: '명함에서 찾고 싶은 내용을 입력하세요',
  TICKET: '티켓에서 출발지나 날짜를 검색해보세요',
  POSTER: '포스터에서 행사명이나 마감일을 검색해보세요',
  RECEIPT: '영수증에서 가게명이나 금액을 검색해보세요',
};

export function chatPlaceholder(docType: ChatDocType | null): string {
  return docType === null ? '문서 유형을 먼저 선택하세요' : PLACEHOLDERS[docType];
}

/**
 * `AppError` → 시스템 말풍선 문구.
 *
 * 401 은 `services/http.ts` 가 이미 세션을 파기하고 만료 핸들러를 호출한 뒤다. 여기서는
 * 말풍선 문구만 만든다 — 라우팅은 세션 가드의 책임이다(스토어에서 `router` 를 부르지 않는다).
 */
export function chatErrorMessage(error: AppError): string {
  switch (error.kind) {
    case 'offline':
      return CHAT_COPY.networkFailed;
    case 'timeout':
      return CHAT_COPY.timeout;
    case 'unauthorized':
      return CHAT_COPY.sessionExpired;
    default:
      return chatRequestFailedMessage(error.status);
  }
}

// ───────────────────────────────────────────────────────────── 메시지 모델

export type ChatRole = 'assistant' | 'user' | 'system';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  at: number;
  /** assistant 메시지에만. 비었으면 키 자체가 없고 화면은 출처 영역을 그리지 않는다. */
  sources?: DocumentSummary[];
  /** system(오류) 메시지에 `다시 시도` 칩을 붙일 때 재전송할 질문. */
  retryQuery?: string;
};

/**
 * 메시지 id. `uuid`/`expo-crypto` 를 끌어오지 않는다(패키지 추가 금지, 그리고 이 id 는
 * 리스트 key 로만 쓰인다). 같은 ms 에 두 건이 생겨도 카운터가 충돌을 막는다.
 */
let sequence = 0;
const nextId = (): string => `${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;

/** 초기 대화 = 인사 말풍선 1개 (SCR-24 초기 상태). */
const initialMessages = (): ChatMessage[] => [
  { id: nextId(), role: 'assistant', text: CHAT_COPY.greeting, at: Date.now() },
];

// ───────────────────────────────────────────────────────────── 스토어

/**
 * 진행 중 요청. 스토어 상태가 아니라 모듈 스코프에 두는 이유:
 * `AbortController` 는 렌더에 영향을 주지 않는 명령형 핸들이라 state 에 넣으면
 * 불필요한 리렌더만 유발한다.
 */
let inflight: AbortController | null = null;

type ChatState = {
  messages: ChatMessage[];
  /** 선택된 문서 유형. `null` 이면 전송 불가 (FR-077). */
  docType: ChatDocType | null;
  /** 타이핑 인디케이터(`답변 작성 중...`)와 입력 disabled 의 단일 근거. */
  isSending: boolean;

  setDocType: (docType: ChatDocType | null) => void;
  /** 전송. 유형 미선택·빈 질문·전송 중이면 조용히 무시한다(버튼이 이미 비활성이어야 한다). */
  send: (query: string) => Promise<void>;
  /** 진행 중 요청 취소. 말풍선은 추가하지 않는다 — 사용자가 스스로 중단한 것이다. */
  cancel: () => void;
  /** 대화 초기화 (FR-080). 인사 말풍선 복원 + 유형 선택 해제 + 진행 중 요청 취소. */
  reset: () => void;
};

export const useChatStore = create<ChatState>((set, get) => ({
  messages: initialMessages(),
  docType: null,
  isSending: false,

  setDocType: (docType) => set({ docType }),

  send: async (rawQuery) => {
    const query = rawQuery.trim();
    const { docType, isSending } = get();
    if (query === '' || docType === null || isSending) return;

    // 사용자 말풍선은 즉시 붙인다 — 왕복이 최대 60초라 응답을 기다렸다 그리면 입력이 사라진 듯 보인다.
    set((state) => ({
      messages: [...state.messages, { id: nextId(), role: 'user', text: query, at: Date.now() }],
      isSending: true,
    }));

    const controller = new AbortController();
    inflight = controller;

    const res = await sendChatMessage({
      query,
      documentType: docType,
      topK: CHAT_TOP_K,
      signal: controller.signal,
    });

    // 취소되었거나(=inflight 가 null) 그 사이 새 전송이 시작된 응답은 버린다.
    if (inflight !== controller) return;
    inflight = null;

    if (!res.ok) {
      set((state) => ({
        isSending: false,
        messages: [
          ...state.messages,
          {
            id: nextId(),
            role: 'system',
            text: chatErrorMessage(res.error),
            at: Date.now(),
            retryQuery: query,
          },
        ],
      }));
      return;
    }

    set((state) => ({
      isSending: false,
      messages: [
        ...state.messages,
        {
          id: nextId(),
          role: 'assistant',
          // 서버가 답변을 비워 보낸 경우의 폴백. 검색 0건 문구는 서버가 이미 채워 보낸다.
          text: res.data.answer || CHAT_COPY.emptyAnswer,
          at: Date.now(),
          ...(res.data.sources.length > 0 ? { sources: res.data.sources } : {}),
        },
      ],
    }));
  },

  cancel: () => {
    inflight?.abort();
    inflight = null;
    set({ isSending: false });
  },

  reset: () => {
    inflight?.abort();
    inflight = null;
    set({ messages: initialMessages(), docType: null, isSending: false });
  },
}));

/** 전송 버튼 활성 조건 (FR-077). 화면이 같은 판정을 다시 짜지 않도록 여기서 한 번만 정의한다. */
export const canSendChat = (docType: ChatDocType | null, draft: string, isSending: boolean) =>
  docType !== null && draft.trim() !== '' && !isSending;
