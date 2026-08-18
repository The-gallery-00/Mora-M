// Some Android deep-link parsers keep the URL host in the path (`/auth/dashboard`).
// Keep this alias so OAuth return URLs never fall through to +not-found.
export { default } from '@/features/auth/OAuthCallbackBridge';
