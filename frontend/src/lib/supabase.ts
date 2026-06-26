// Supabase client — the single identity source for the SPA.
//
// Supabase manages the session, refresh tokens, OAuth redirects, password
// reset and email verification. We never store raw tokens in localStorage
// ourselves; supabase-js persists the session securely and refreshes it.
//
// Required env (frontend/.env):
//   VITE_SUPABASE_URL=https://<project>.supabase.co
//   VITE_SUPABASE_ANON_KEY=<anon public key>
//
// Install the dependency:  npm i @supabase/supabase-js

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  // Fail loud in dev so misconfiguration is obvious.
  // eslint-disable-next-line no-console
  console.error(
    "[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Auth will not work."
  );
}

// --- "Remember me" -----------------------------------------------------------
// supabase-js fixes its storage backend at client-creation time, so we install
// a hybrid adapter that routes the persisted session to either localStorage
// (remember = survives browser restart) or sessionStorage (forget = cleared on
// close). The preference itself lives in localStorage so it is stable, and the
// caller must set it BEFORE sign-in so the session token lands in the right bin.
const REMEMBER_KEY = "cs.auth.remember";

function rememberMe(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== "false"; // default: remember
  } catch {
    return true;
  }
}

/** Set the remember-me preference. Call before signInWithPassword. */
export function setRememberMe(remember: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? "true" : "false");
  } catch {
    /* storage unavailable (private mode) — sessions become session-only */
  }
}

const hybridStorage = {
  getItem: (key: string): string | null => {
    try {
      // Prefer the active bin, but fall back to the other so a session that
      // already exists is still found if the preference changed.
      const primary = rememberMe() ? localStorage : sessionStorage;
      const other = rememberMe() ? sessionStorage : localStorage;
      return primary.getItem(key) ?? other.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      const primary = rememberMe() ? localStorage : sessionStorage;
      const other = rememberMe() ? sessionStorage : localStorage;
      primary.setItem(key, value);
      other.removeItem(key); // never leave a stale copy in the wrong bin
    } catch {
      /* ignore */
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // handles OAuth + recovery redirects
    storage: hybridStorage,
  },
});

/** Current access token (Supabase JWT) for Authorization headers, or null. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
