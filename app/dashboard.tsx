// OAuth providers return to `mora://auth/dashboard?...`.
// Expo Router can surface that as `/dashboard`, so this route must behave as SCR-05.
export { default } from '@/features/auth/OAuthCallbackBridge';
