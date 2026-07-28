// src/features/onboarding/seen.ts
//
// 온보딩 1회성 플래그 (SCR-01 부트 분기 · SCR-02 완료 기록).
//
// 키의 정본은 `StorageKey.onboardingSeen`(= `onboarding.seen`) 이고 저장소는 MMKV 다.
// 부팅 첫 프레임에 **동기로** 읽어야 분기에서 흰 화면이 생기지 않기 때문에 AsyncStorage 를 쓰지 않는다
// (Offline and State §1-4). 계정 종속 데이터가 아니므로 로그아웃 시에도 지우지 않는다
// (Auth.md §4-5 — 지우는 것은 탈퇴뿐이다).
//
// 읽기/쓰기를 이 한 파일에 모은 이유: 값 타입(boolean)이 두 화면에서 어긋나면
// 온보딩이 매 실행 다시 뜨는 회귀가 조용히 생긴다.
import { StorageKey, storage } from '@/store/storage';

/** 온보딩을 이미 봤는가. 저장 실패·미저장·오염된 값은 전부 '안 봤다'로 본다. */
export function hasSeenOnboarding(): boolean {
  try {
    return storage.getBoolean(StorageKey.onboardingSeen) === true;
  } catch {
    return false;
  }
}

/**
 * 온보딩 완료 기록.
 * 저장 실패는 삼킨다 — SCR-02 인터랙션 표: "저장 실패해도 이동은 강행".
 */
export function markOnboardingSeen(): void {
  try {
    storage.set(StorageKey.onboardingSeen, true);
  } catch {
    // 다음 실행에서 온보딩이 한 번 더 뜰 뿐, 사용자를 막지 않는다.
  }
}
