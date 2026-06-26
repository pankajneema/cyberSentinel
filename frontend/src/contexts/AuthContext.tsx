// AuthContext — single source of truth for the user's session in the SPA.
//
// Wraps the app, subscribes to Supabase auth state, and exposes typed helpers
// for the auth flows. No component should call supabase.auth directly; use this.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, setRememberMe } from "@/lib/supabase";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
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
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const redirectTo = (path: string) =>
  `${window.location.origin}${path}`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,

      async signInWithPassword(email, password, remember = true) {
        // Choose the storage bin before Supabase writes the session token.
        setRememberMe(remember);
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw error;
      },

      async signInWithOAuth(provider) {
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: redirectTo("/app/dashboard") },
        });
        if (error) throw error;
      },

      async signUp({ email, password, fullName, companyName }) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, company_name: companyName },
            emailRedirectTo: redirectTo("/login"),
          },
        });
        if (error) throw error;
        // When email confirmation is on, there is a user but no session yet.
        const needsEmailConfirmation = !data.session;
        return { needsEmailConfirmation };
      },

      async signOut() {
        await supabase.auth.signOut();
      },

      async sendPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: redirectTo("/reset-password"),
        });
        if (error) throw error;
      },

      async updatePassword(newPassword) {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
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
