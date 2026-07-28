// src/components/ui/toastStore.ts
//
// CMP-16 Toast — 상태와 명령형 API. 라이브러리를 쓰지 않는 이유는 Component Library §5-2:
// 토스트는 100줄 미만인데 탭바 높이 오프셋·햅틱 연동·액션 버튼 커스터마이징 비용이 라이브러리 이점을 넘는다.
//
// 컴포넌트 트리 밖(http 인터셉터, 세션 만료 핸들러 등)에서도 호출할 수 있어야 하므로
// zustand 스토어의 `getState()` 를 감싼 명령형 `toast` 객체를 함께 내보낸다.
// **동시에 1개만 표시**한다 — 표시 로직은 `<ToastHost/>`(Toast.tsx) 가 소유한다.
import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info' | 'warn';

export interface ToastOptions {
  message: string;
  tone?: ToastTone; // default 'info'
  /** ms. 미지정 시 액션 있으면 6000, 없으면 2500 (UX 가이드 §7-1) */
  duration?: number;
  actionLabel?: string; // 예: '실행 취소'
  onAction?: () => void;
  /** tone 에 맞는 햅틱. default true (HAP-02/03/04) */
  haptic?: boolean;
}

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  duration: number;
  actionLabel?: string;
  onAction?: () => void;
  haptic: boolean;
}

/** 성공·정보 2500ms / 액션 포함 6000ms — UX 가이드 §7-1 · MOT-09 */
const DURATION_DEFAULT = 2500;
const DURATION_WITH_ACTION = 6000;

type ToastState = {
  current: ToastItem | null;
  show: (options: ToastOptions) => void;
  /** id 를 주면 그 토스트일 때만 닫는다(타이머 경합 방지) */
  hide: (id?: number) => void;
};

let sequence = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  current: null,

  show: (options) => {
    sequence += 1;
    const item: ToastItem = {
      id: sequence,
      message: options.message,
      tone: options.tone ?? 'info',
      duration: options.duration ?? (options.actionLabel ? DURATION_WITH_ACTION : DURATION_DEFAULT),
      haptic: options.haptic ?? true,
    };
    if (options.actionLabel !== undefined) item.actionLabel = options.actionLabel;
    if (options.onAction !== undefined) item.onAction = options.onAction;
    set({ current: item });
  },

  hide: (id) => {
    if (id !== undefined && get().current?.id !== id) return;
    set({ current: null });
  },
}));

type ToastShorthand = (
  message: string,
  options?: Omit<ToastOptions, 'message' | 'tone'>,
) => void;

const shorthand =
  (tone: ToastTone): ToastShorthand =>
  (message, options) =>
    useToastStore.getState().show({ ...options, message, tone });

/**
 * 전역 명령형 API. 훅이 아니므로 어디서든 호출할 수 있다.
 * 문구는 UX 가이드 §7-2 의 CP-## 최종안을 그대로 넘긴다(서버 error 문자열 직접 노출 금지).
 */
export const toast = {
  show: (options: ToastOptions) => useToastStore.getState().show(options),
  success: shorthand('success'),
  error: shorthand('error'),
  info: shorthand('info'),
  warn: shorthand('warn'),
  hide: () => useToastStore.getState().hide(),
};
