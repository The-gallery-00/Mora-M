import { Image, type ImageProps } from 'expo-image';
import { useMemo } from 'react';

import { getDocumentImageSource } from '@/services/documentImages';
import { useAuthStore } from '@/store/authStore';

type DocumentImageProps = Omit<ImageProps, 'source' | 'cachePolicy' | 'recyclingKey' | 'placeholder'> & {
  uri: string | null | undefined;
};

/** Private documents use reactive credentials and never persist pixels to disk. */
export function DocumentImage({ uri, ...props }: DocumentImageProps) {
  const token = useAuthStore((state) => state.status === 'authenticated' ? state.token : null);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const source = useMemo(() => getDocumentImageSource(uri, { token, userId }), [uri, token, userId]);
  if (!source) return null;

  return (
    <Image
      {...props}
      key={source.cacheKey}
      source={source}
      cachePolicy="memory"
      recyclingKey={source.cacheKey}
    />
  );
}
