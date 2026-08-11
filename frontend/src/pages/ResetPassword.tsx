// Reset password — the page the emailed (or, absent real email delivery,
// dev-console-logged) reset link lands on: /reset-password?token=<token>.
// Unlike Supabase's magic-link flow, there is no ambient session here — the
// token itself is the credential, sent once to an unauthenticated endpoint.

import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("This reset link is invalid or missing its token.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await resetPassword({ token, newPassword: password });
      // The backend revokes every existing session on a password reset, so
      // there's no live session to land the user in — go to /login, not the
      // dashboard.
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">Set a new password</h1>
        <p className="text-sm text-muted-foreground">Choose a strong password you don't use elsewhere.</p>
      </div>

      {!token ? (
        <p className="rounded-md border bg-destructive/10 p-4 text-sm text-destructive">
          This reset link is invalid or has expired.{" "}
          <Link to="/forgot-password" className="underline">Request a new one</Link>.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">New password</label>
            <input
              type="password" required minLength={8} value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm" placeholder="At least 8 characters"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Confirm password</label>
            <input
              type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Re-enter password"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      )}
    </div>
  );
}
