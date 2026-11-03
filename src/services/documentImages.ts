import type { ImageSource } from 'expo-image';

import { isTrustedDocumentImageUrl, resolveImageUrl } from '@/config/env';

type ImageSession = { token: string | null; userId: string | null };

/** Shared request source: credentials never accompany external or non-upload URLs. */
export function getDocumentImageSource(
  imageUrl: string | null | undefined,
  session: ImageSession,
): ImageSource | null {
  const uri = resolveImageUrl(imageUrl);
  if (!uri) return null;
  const trusted = isTrustedDocumentImageUrl(uri);
  if (trusted && (!session.token || !session.userId)) return null;

  return {
    uri,
    ...(trusted ? { headers: { Authorization: `Bearer ${session.token}` } } : {}),
    // The URL alone is not a safe cache identity across account switches.
    cacheKey: JSON.stringify(['document', session.userId, uri]),
  };
}
