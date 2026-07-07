import { useEffect, useState } from "react";
import { getMe, type MeResponse } from "@/lib/services/auth";
import { canWrite as roleCanWrite } from "@/lib/permissions";

// Module-level cache: the profile is fetched once per session and shared by
// every consumer of the hook instead of each page calling getMe() itself.
let cache: MeResponse | null = null;
let inflight: Promise<MeResponse> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function fetchMe(): Promise<MeResponse> {
  if (!inflight) {
    inflight = getMe()
      .then((me) => {
        cache = me;
        notify();
        return me;
      })
      .catch((err) => {
        inflight = null;
        throw err;
      });
  }
  return inflight;
}

/** Force a refetch (e.g. after a profile update) and update all consumers. */
export function refreshMe(): Promise<MeResponse> {
  inflight = null;
  return fetchMe();
}

export interface UseMeResult {
  me: MeResponse | null;
  /** Falls back to "reader" while loading or when the profile fetch fails. */
  role: string;
  canWrite: boolean;
  loading: boolean;
}

export function useMe(): UseMeResult {
  const [me, setMe] = useState<MeResponse | null>(cache);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    let mounted = true;
    const sync = () => {
      if (mounted) setMe(cache);
    };
    listeners.add(sync);
    fetchMe()
      .catch(() => {
        // Consumers gate on role "reader" when the profile is unavailable.
      })
      .finally(() => {
        if (mounted) {
          sync();
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
      listeners.delete(sync);
    };
  }, []);

  const role = me?.role ?? "reader";
  return { me, role, canWrite: roleCanWrite(role), loading };
}
