// OAuth landing page — routes/oauth.py redirects here after a successful
// Google/GitHub login, with tokens in the URL *fragment*
// (#access_token=...&refresh_token=...), never the query string, so they're
// never sent to any server past this navigation or logged anywhere.
//
// On failure the backend instead redirects to /login?error=<code>, so this
// page only ever has to handle the success shape — but still guards against a
// malformed/missing fragment defensively.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { completeOAuthLogin } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke guard — tokens are single-use in spirit
    ran.current = true;

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");

    // Scrub the tokens out of the URL/history immediately, success or not.
    window.history.replaceState(null, "", "/auth/callback");

    if (!accessToken || !refreshToken || !completeOAuthLogin(accessToken, refreshToken)) {
      setError("Sign-in didn't complete. Please try again.");
      return;
    }
    navigate("/app/dashboard", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <a href="/login" className="text-sm text-primary hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Signing you in…
    </div>
  );
}
