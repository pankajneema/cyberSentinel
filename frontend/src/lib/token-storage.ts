// Local token storage — replaces the Supabase-js storage adapter.
//
// We are the identity provider now: the backend issues an access+refresh
// token pair (routes/auth.py, routes/oauth.py) and this module is the only
// place that reads/writes them.
//
// "Remember me" behavior is unchanged from before: the preference lives in
// localStorage (stable across sessions), and it decides whether the tokens
// themselves go in localStorage (survives browser restart) or sessionStorage
// (cleared on close). Must be set BEFORE login/signup so the tokens land in
// the right bin.

const REMEMBER_KEY = "cs.auth.remember";
const TOKENS_KEY = "cs.auth.tokens";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

function rememberMe(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== "false"; // default: remember
  } catch {
    return true;
  }
}

/** Set the remember-me preference. Call before login/signup. */
export function setRememberMe(remember: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? "true" : "false");
  } catch {
    /* storage unavailable (private mode) — tokens become session-only */
  }
}

export function getTokens(): Tokens | null {
  try {
    const primary = rememberMe() ? localStorage : sessionStorage;
    const other = rememberMe() ? sessionStorage : localStorage;
    const raw = primary.getItem(TOKENS_KEY) ?? other.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

export function setTokens(accessToken: string, refreshToken: string): void {
  try {
    const primary = rememberMe() ? localStorage : sessionStorage;
    const other = rememberMe() ? sessionStorage : localStorage;
    primary.setItem(TOKENS_KEY, JSON.stringify({ accessToken, refreshToken }));
    other.removeItem(TOKENS_KEY); // never leave a stale copy in the wrong bin
  } catch {
    /* ignore */
  }
}

export function clearTokens(): void {
  try {
    localStorage.removeItem(TOKENS_KEY);
    sessionStorage.removeItem(TOKENS_KEY);
  } catch {
    /* ignore */
  }
}
