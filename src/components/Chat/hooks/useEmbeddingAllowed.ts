import { useState, useEffect } from 'react';

let cachedResult: boolean | null = null;
let fetchPromise: Promise<boolean> | null = null;

/**
 * Detects if Grafana allows embedding by checking the X-Frame-Options header.
 * Returns null while loading, true if allowed, false if denied.
 */
export function useEmbeddingAllowed(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(cachedResult);

  useEffect(() => {
    if (cachedResult !== null) {
      return;
    }

    let mounted = true;

    if (!fetchPromise) {
      fetchPromise = fetch(window.location.origin + '/api/health', { method: 'HEAD' })
        .then((response) => {
          const xFrameOptions = response.headers.get('X-Frame-Options');
          cachedResult = !xFrameOptions || xFrameOptions.toLowerCase() !== 'deny';
          return cachedResult;
        })
        .catch(() => {
          cachedResult = false;
          return false;
        });
    }

    fetchPromise.then((result) => {
      if (mounted) {
        setAllowed(result);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  return allowed;
}
