import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * JWT 는 반드시 SecureStore(Android Keystore 로 암호화)에만 둔다.
 * MMKV/AsyncStorage 는 평문 파일이라 루팅·백업 추출로 노출된다.
 */
const TOKEN_KEY = 'mora.jwt';
const USER_KEY = 'mora.user';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  picture?: string;
  provider?: string;
};

// SecureStore 는 비동기라 매 요청마다 await 하면 지연이 쌓인다.
// 앱 부팅 시 한 번 읽어 메모리에 캐시하고, 이후 변경 시점에만 동기화한다.
let cachedToken: string | null = null;
let loaded = false;

function getWebItem(key: string): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return window.localStorage.getItem(key);
}

function setWebItem(key: string, value: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.localStorage.setItem(key, value);
}

function removeWebItem(key: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.localStorage.removeItem(key);
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return getWebItem(key);
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    setWebItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    removeWebItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function loadSession(): Promise<string | null> {
  if (!loaded) {
    cachedToken = await getItem(TOKEN_KEY);
    loaded = true;
  }
  return cachedToken;
}

export function getTokenSync(): string | null {
  return cachedToken;
}

export async function saveSession(token: string, user?: SessionUser): Promise<void> {
  cachedToken = token;
  loaded = true;
  await setItem(TOKEN_KEY, token);
  if (user) await setItem(USER_KEY, JSON.stringify(user));
}

export async function getCachedUser(): Promise<SessionUser | null> {
  const raw = await getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  cachedToken = null;
  loaded = true;
  await deleteItem(TOKEN_KEY);
  await deleteItem(USER_KEY);
}
