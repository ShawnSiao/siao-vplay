import { useEffect, useState } from "react";
import { getPublicResolverDisclosure } from "../../lib/desktop";

export type ResolverDisclosure = { receiver: string; resolverBase: string };
export function usePublicResolverConsent(url: string, enabled: boolean) {
  const [disclosure, setDisclosure] = useState<ResolverDisclosure | null>(null);
  const [confirmation, setConfirmation] = useState<{ url: string; resolverBase: string } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void getPublicResolverDisclosure().then((result) => {
      if (active) { setDisclosure(result); setError(false); }
    }).catch(() => { if (active) { setDisclosure(null); setError(true); } });
    return () => { active = false; };
  }, [url, enabled]);
  const authorized = enabled && confirmation?.url === url && confirmation.resolverBase === disclosure?.resolverBase;
  return { disclosure, error, authorized, authorize: (value: boolean) => setConfirmation(value && disclosure ? { url, resolverBase: disclosure.resolverBase } : null),
    resolverBase: authorized && disclosure ? disclosure.resolverBase : null };
}
