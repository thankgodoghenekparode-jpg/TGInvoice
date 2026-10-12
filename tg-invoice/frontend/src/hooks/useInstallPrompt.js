import { useEffect, useState } from 'react';

/**
 * Tracks PWA installability.
 *
 * - `canInstall` becomes true once the browser fires `beforeinstallprompt`
 *   (Android/Chrome/Edge) and the app is not already installed.
 * - `installed` reflects the standalone display mode (covers iOS, where the
 *   install prompt API does not exist — use the Share → "Add to Home Screen").
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(
    () =>
      (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
      (typeof navigator !== 'undefined' && navigator.standalone === true)
  );

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      setDeferred(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferred) return false;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return outcome === 'accepted';
  };

  return { canInstall: Boolean(deferred) && !installed, installed, promptInstall };
}
