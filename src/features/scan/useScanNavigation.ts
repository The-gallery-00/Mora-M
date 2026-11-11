import { useNavigation, useRouter } from 'expo-router';
import { useCallback } from 'react';

export function useScanNavigation() {
  const router = useRouter();
  const rootNavigation = useNavigation('/');

  const toCamera = useCallback(() => {
    // Reuse the camera below crop/review instead of creating a second preview.
    router.dismissTo('/scan');
  }, [router]);

  const close = useCallback(() => {
    // Target the root stack so nested camera history cannot consume this exit.
    // Without screen params, the previously selected tab remains selected.
    const state = rootNavigation.getState();
    if (!state) {
      router.dismissTo('/(tabs)');
      return;
    }
    rootNavigation.dispatch({
      type: 'POP_TO',
      target: state.key,
      payload: { name: '(tabs)', merge: true },
    });
  }, [rootNavigation, router]);

  return { toCamera, close };
}
