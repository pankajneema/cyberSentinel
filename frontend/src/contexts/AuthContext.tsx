// AuthContext — single source of truth for the user's session in the SPA.
//
// Wraps the app and exposes typed helpers for the auth flows, backed by our
// own API (routes/auth.py, routes/oauth.py) rather than an external identity
// provider. No component should touch token storage directly; use this.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getTokens, setTokens, clearTokens, setRememberMe } from "@/lib/token-storage";
import { API_BASE } from "@/lib/api";
import {
  login as loginApi,
  signup as signupApi,
  logout as logoutApi,
  forgotPassword as forgotPasswordApi,
  resetPassword as resetPasswordApi,
  changePassword as changePasswordApi,
  type AuthResponse,
} from "@/lib/services/auth";

interface AuthUser {
  id: string;
  email: string;
  full_name?: string | null;
  role: string;
}

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface AuthContextValue {
  session: AuthSession | null;
  user: AuthUser | null;
  loading: boolean;
  signInWithPassword: (
    email: string,
    password: string,
    remember?: boolean
  ) => Promise<void>;
  signInWithOAuth: (provider: "google" | "github") => Promise<void>;
  signUp: (args: {
    email: string;
    password: string;
    fullName: string;
    companyName?: string;
  }) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: (opts?: { all?: boolean }) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resetPassword: (args: { token: string; newPassword: string }) => Promise<void>;
  updatePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Used only by AuthCallback.tsx after an OAuth redirect delivers tokens via
   * the URL fragment — updates live context state, not just storage, so the
   * immediately-following client-side navigate() into /app/* isn't blocked by
   * RequireAuth still holding a stale (pre-login) session. Returns false if
   * the tokens didn't decode (caller should show an error, not navigate). */
  completeOAuthLogin: (accessToken: string, refreshToken: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Decode a JWT's payload without verifying it — display purposes only. The
 * backend re-verifies the signature on every request; nothing here is trusted
 * for authorization decisions. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function sessionFromTokens(accessToken: string, refreshToken: string): AuthSession | null {
  const claims = decodeJwtPayload(accessToken);
  const sub = claims?.sub as string | undefined;
  const email = claims?.email as string | undefined;
  if (!sub || !email) return null;
  return {
    accessToken,
    refreshToken,
    user: { id: sub, email, role: (claims?.role as string) || "reader" },
  };
}

function sessionFromAuthResponse(res: AuthResponse): AuthSession {
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    user: res.user,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tokens = getTokens();
    if (tokens) {
      const restored = sessionFromTokens(tokens.accessToken, tokens.refreshToken);
      if (restored) {
        setSession(restored);
      } else {
        clearTokens();
      }
    }
    setLoading(false);
  }, []);

  function applyTokens(res: AuthResponse) {
    setTokens(res.access_token, res.refresh_token);
    setSession(sessionFromAuthResponse(res));
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,

      async signInWithPassword(email, password, remember = true) {
        // Choose the storage bin before the token gets written.
        setRememberMe(remember);
        const res = await loginApi({ email: email.trim().toLowerCase(), password });
        applyTokens(res);
      },

      async signInWithOAuth(provider) {
        // Full-page navigation — the backend redirects to the provider, then
        // back to /auth/callback with tokens in the URL fragment.
        window.location.href = `${API_BASE}/auth/oauth/${provider}`;
      },

      async signUp({ email, password, fullName, companyName }) {
        const res = await signupApi({
          email: email.trim().toLowerCase(),
          password,
          full_name: fullName,
          company_name: companyName,
        });
        applyTokens(res);
        // No email-verification gate in this auth system — always immediate.
        return { needsEmailConfirmation: false };
      },

      async signOut(opts) {
        const tokens = getTokens();
        try {
          if (tokens) {
            await logoutApi({ refresh_token: tokens.refreshToken, all: opts?.all });
          }
        } catch {
          /* best-effort — clear locally regardless */
        } finally {
          clearTokens();
          setSession(null);
        }
      },

      async sendPasswordReset(email) {
        await forgotPasswordApi({ email });
      },

      async resetPassword({ token, newPassword }) {
        await resetPasswordApi({ token, new_password: newPassword });
      },

      async updatePassword(currentPassword, newPassword) {
        await changePasswordApi({ current_password: currentPassword, new_password: newPassword });
      },

      completeOAuthLogin(accessToken, refreshToken) {
        const restored = sessionFromTokens(accessToken, refreshToken);
        if (!restored) return false;
        setTokens(accessToken, refreshToken);
        setSession(restored);
        return true;
      },
    }),
    [session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
