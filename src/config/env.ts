import Constants from 'expo-constants';

import { StorageKey, storage } from '@/store/storage';

/**
 * 서버 주소 해석 (ADR-002: LAN IP 직결 + 런타임 오버라이드).
 *
 * 우선순위:
 *   1. MMKV 런타임 오버라이드 — 진단 화면(SCR-31)에서 사용자가 입력한 값.
 *      APK 를 다시 빌드하지 않고 개발 PC 의 IP 변경에 대응하기 위한 장치다.
 *   2. 빌드 시 주입된 EXPO_PUBLIC_* 환경변수.
 *   3. 하드코딩 폴백 — 안드로이드 에뮬레이터에서 호스트 PC 를 가리키는 특수 주소.
 */
const FALLBACK_API = 'http://10.0.2.2:8080';
const FALLBACK_OCR = 'http://10.0.2.2:8000';

export type Variant = 'development' | 'preview' | 'production';

export const variant: Variant =
  (Constants.expoConfig?.extra?.variant as Variant | undefined) ?? 'development';

/** 끝의 슬래시를 떼고 스킴 누락을 보정한다. 사용자 입력을 그대로 신뢰하지 않는다. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  const override = storage.getString(StorageKey.serverApiUrl);
  if (override) return normalizeBaseUrl(override);
  return normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL ?? FALLBACK_API);
}

export function getOcrBaseUrl(): string {
  const override = storage.getString(StorageKey.serverOcrUrl);
  if (override) return normalizeBaseUrl(override);
  return normalizeBaseUrl(process.env.EXPO_PUBLIC_OCR_URL ?? FALLBACK_OCR);
}

export function setServerOverride(apiUrl: string, ocrUrl: string): void {
  storage.set(StorageKey.serverApiUrl, normalizeBaseUrl(apiUrl));
  storage.set(StorageKey.serverOcrUrl, normalizeBaseUrl(ocrUrl));
}

export function clearServerOverride(): void {
  storage.remove(StorageKey.serverApiUrl);
  storage.remove(StorageKey.serverOcrUrl);
}

export function hasServerOverride(): boolean {
  return storage.contains(StorageKey.serverApiUrl);
}

/**
 * OCR 서버가 돌려주는 image_url 은 `/uploads/...` 상대경로다.
 * 정적 파일은 Spring(:8080) 이 아니라 OCR(:8000) 이 서브하므로 OCR base 로 조립해야 한다.
 * 원본: ocr/app.py — app.mount("/uploads", StaticFiles(...))
 */
export function resolveImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const path = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
  return `${getOcrBaseUrl()}${path}`;
}
