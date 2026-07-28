import { createMMKV } from 'react-native-mmkv';

/**
 * 앱 영속 저장소 (비민감 데이터 전용).
 * 토큰·비밀정보는 절대 여기 두지 않는다 — expo-secure-store 를 쓴다.
 *
 * 키 목록의 정본은 wiki/tech/Offline and State.md.
 *
 * react-native-mmkv v4 는 Nitro 기반이라 `new MMKV()` 가 아니라 `createMMKV()` 를 쓴다.
 * 삭제 API 도 `delete()` 가 아니라 `remove()` 다.
 */
export const storage = createMMKV({ id: 'mora' });

export const StorageKey = {
  themeMode: 'theme.mode',
  searchLastDocType: 'search.lastDocType',
  serverApiUrl: 'server.apiUrl',
  serverOcrUrl: 'server.ocrUrl',
  onboardingSeen: 'onboarding.seen',
} as const;

/** zustand persist 용 어댑터. */
export const mmkvJsonStorage = {
  getItem: (name: string) => storage.getString(name) ?? null,
  setItem: (name: string, value: string) => {
    storage.set(name, value);
  },
  removeItem: (name: string) => {
    storage.remove(name);
  },
};
