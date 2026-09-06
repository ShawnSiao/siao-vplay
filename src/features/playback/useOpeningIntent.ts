import { useMemo, useRef } from "react";

export type IsCurrentOpening = () => boolean;

export function useOpeningIntent() {
  const sequence = useRef(0);
  return useMemo(() => ({
    invalidate: () => { sequence.current += 1; },
    run: async (operation: (isCurrent: IsCurrentOpening) => Promise<void>) => {
      const identity = ++sequence.current;
      const isCurrent = () => sequence.current === identity;
      try {
        await operation(isCurrent);
      } catch (error) {
        if (isCurrent()) throw error;
      }
    },
  }), []);
}
