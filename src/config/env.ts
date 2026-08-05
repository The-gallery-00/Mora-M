import Constants from 'expo-constants';

import { clearSession } from '@/services/session';
import { StorageKey, storage } from '@/store/storage';

/**
 * 서버 주소 해석 (ADR-002: 배포 서버 기본값 + 런타임 오버라이드).
 *
 * 우선순위:
 *   1. MMKV 런타임 오버라이드 — 진단 화면(SCR-31)에서 사용자가 입력한 값.
 *      APK 를 다시 빌드하지 않고 개발 PC 의 IP 변경에 대응하기 위한 장치다.
 *   2. 빌드 시 주입된 EXPO_PUBLIC_* 환경변수.
 *   3. 하드코딩 폴백 — 로컬 Gradle APK 처럼 EAS env 를 거치지 않는 빌드도
 *      팀원이 바로 테스트할 수 있도록 Cloud Run 배포 서버를 가리킨다.
 *
 * 로컬 개발 서버에 붙일 때는 `.env` 또는 진단 화면(SCR-31)에서
 * http://10.0.2.2:8080 / http://10.0.2.2:8000 으로 오버라이드한다.
 *
 * ⚠️ 1번(오버라이드)은 **로그인 세션이 어느 서버로 나가는지를 통째로 바꾸는 스위치**다.
 * 그래서 API 주소를 바꾸는 저장·해제는 반드시 세션 파기를 동반한다 — `setServerOverride` 주석.
 */
const FALLBACK_API = 'https://mora-mobile-spring-971562891559.asia-northeast3.run.app';
const FALLBACK_OCR = 'https://mora-mobile-ocr-971562891559.asia-northeast3.run.app';

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

/**
 * 오버라이드가 **없을 때** 쓰는 주소(빌드 주입 → 하드코딩 폴백).
 *
 * `getApiBaseUrl()` 과 "오버라이드를 지우면 어떤 주소가 되는가" 판정이 **같은 계산**을 쓰게
 * 하려고 뽑았다. 두 벌로 적으면 [초기화] 가 주소를 바꾸는지 여부를 화면이 틀리게 말할 수 있다.
 * `process.env.EXPO_PUBLIC_*` 는 Expo 바벨 플러그인이 **정확한 멤버 표현식만** 정적 치환하므로
 * 동적 인덱싱으로 묶지 않고 두 함수로 그대로 적는다.
 */
function buildApiBaseUrl(): string {
  return normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL ?? FALLBACK_API);
}

function buildOcrBaseUrl(): string {
  return normalizeBaseUrl(process.env.EXPO_PUBLIC_OCR_URL ?? FALLBACK_OCR);
}

export function getApiBaseUrl(): string {
  const override = storage.getString(StorageKey.serverApiUrl);
  if (override) return normalizeBaseUrl(override);
  return buildApiBaseUrl();
}

export function getOcrBaseUrl(): string {
  const override = storage.getString(StorageKey.serverOcrUrl);
  if (override) return normalizeBaseUrl(override);
  return buildOcrBaseUrl();
}

/**
 * ⚠️ **API 주소 교체 = 세션 파기.** 이 파일이 지키는 보안 불변식이고, 아래 두 함수의 존재 이유다.
 *
 * 2026-08-05 4차 — 종전에는 진단 화면(SCR-31)이 프로브에 토큰을 붙일지만 따졌고,
 * **저장 자체는 아무 방어 없이 통과했다.** 그래서 실제 경로는 이랬다:
 *   1. 진단 화면에 `http://남의호스트` 를 입력 → [연결 확인]
 *   2. 프로브는 토큰을 빼고 "인증 없음 — …보내지 않았습니다" 를 표시 (여기까지는 사실)
 *   3. 그러나 그 주소는 **이미 MMKV 에 영구 저장**됐다 → 이후 `getApiBaseUrl()` 이 그 값을 준다
 *   4. 뒤로 나가 명함첩 탭이 목록을 부르는 순간 `services/http.ts` `request()` 가
 *      (`anonymous` 가 아닌 모든 요청에) `Authorization: Bearer <jwt>` 를 붙여 그 호스트로 보낸다
 *      (`src/services/http.ts:183-185`, 스캔 업로더는 `src/features/scan/api.ts:231-234`).
 * 즉 프로브 1회를 막고 그 뒤 **모든** 요청을 흘려보내는 구조였다. 방어선을 프로브가 아니라
 * **저장 시점**으로 옮긴다 — 저장 경로가 하나뿐이므로 여기서 막으면 우회할 수 있는 호출부가 없다.
 *
 * 세션 파기가 보안과 정합성 양쪽에서 옳다: 새 서버는 우리 서버가 아니거나(유출) 우리 서버라도
 * 별개 DB/시크릿이라(JWT 서명키가 다르다) 기존 토큰은 어차피 그 서버에서 무효다.
 *
 * 기준은 **API 주소가 실제로 바뀌는가** 하나다. OCR 주소만 바뀌면 세션을 건드리지 않는다 —
 * OCR 로 나가는 두 요청 모두 토큰을 싣지 않기 때문이다(`/health` 무인증,
 * `/api/commit` 은 `authorize: false` — `src/features/scan/api.ts:551-554`).
 * 근거 없이 로그아웃시키면 다음 사람이 이 규칙을 우회할 방법을 찾는다.
 *
 * 여기서는 **토큰 정본(SecureStore)만** 지운다. zustand 스토어 상태·React Query 캐시·이미지
 * 캐시까지 정리하는 것은 `authStore.signOut()` 의 일이고, 화면이 이어서 부른다
 * (`app/(dev)/diagnostics.tsx`). 순서를 이렇게 둔 이유: 화면 쪽 정리가 실패하더라도
 * **토큰은 이미 사라진 뒤**여야 한다. 반대로 두면 실패 시 유출이 남는다.
 */
async function clearSessionIfApiHostChanges(nextApiUrl: string): Promise<boolean> {
  if (nextApiUrl === getApiBaseUrl()) return false;
  await clearSession();
  return true;
}

/**
 * 오버라이드 저장. **API 주소가 바뀌면 저장 전에 세션을 파기한다** (위 주석).
 * @returns API 주소가 바뀌어 세션을 파기했으면 true. 화면 문구가 이 값과 어긋나면 안 된다.
 */
export async function setServerOverride(apiUrl: string, ocrUrl: string): Promise<boolean> {
  const nextApi = normalizeBaseUrl(apiUrl);
  // 빈 문자열을 저장하면 `getApiBaseUrl()` 이 다시 빌드 기본값을 준다(`if (override)`).
  // 그러므로 비교 대상은 입력값이 아니라 **저장 후 실제로 쓰게 될 주소**다 —
  // 입력값으로 비교하면 주소가 그대로인데도 로그아웃시키는 거짓 동작이 생긴다.
  const sessionCleared = await clearSessionIfApiHostChanges(nextApi || buildApiBaseUrl());
  storage.set(StorageKey.serverApiUrl, nextApi);
  storage.set(StorageKey.serverOcrUrl, normalizeBaseUrl(ocrUrl));
  return sessionCleared;
}

/**
 * 오버라이드 해제. 이것도 **API 주소 교체**다(오버라이드 주소 → 빌드 기본값) —
 * 저장 때만 세션을 파기하고 해제 때는 놔두면, 오버라이드 서버에서 받은 토큰이 빌드 기본
 * 서버로 그대로 날아간다. 방향만 반대일 뿐 같은 결함이라 같은 규칙을 적용한다.
 * @returns API 주소가 바뀌어 세션을 파기했으면 true.
 */
export async function clearServerOverride(): Promise<boolean> {
  const sessionCleared = await clearSessionIfApiHostChanges(buildApiBaseUrl());
  storage.remove(StorageKey.serverApiUrl);
  storage.remove(StorageKey.serverOcrUrl);
  return sessionCleared;
}

/**
 * [초기화] 를 지금 누르면 **API 주소가 실제로 바뀌는가** (= 세션이 파기되는가).
 *
 * 화면이 확인 대화상자에 "로그아웃됩니다" 를 적을지 결정하는 데 쓴다. 오버라이드 문자열이
 * 빌드 기본값과 같은 경우처럼 "오버라이드는 있지만 주소는 같은" 상태가 실제로 존재하므로,
 * `hasServerOverride()` 로 대신 판단하면 화면이 일어나지도 않을 로그아웃을 예고하게 된다.
 */
export function willClearChangeApiHost(): boolean {
  return buildApiBaseUrl() !== getApiBaseUrl();
}

export function hasServerOverride(): boolean {
  return storage.contains(StorageKey.serverApiUrl);
}

/**
 * OCR 서버가 돌려주는 image_url 은 `/uploads/...` 상대경로다.
 * 정적 파일은 Spring(:8080) 이 아니라 OCR(:8000) 이 서브하므로 OCR base 로 조립해야 한다.
 * 원본: `server/ocr/app.py` 의 `@app.get("/uploads/{image_name}")`.
 * (`app.mount("/uploads", StaticFiles(...))` 가 아니다 — 배포 환경은 GCS 에서 스트리밍하고
 *  LAN 개발에서만 디스크를 읽으므로 핸들러가 그 분기를 직접 한다.)
 */
export function resolveImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const path = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
  return `${getOcrBaseUrl()}${path}`;
}
