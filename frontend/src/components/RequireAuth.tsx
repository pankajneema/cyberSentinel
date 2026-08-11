// Route guard — blocks the entire /app/* tree behind a valid session.
// Without this, authenticated routes render to anonymous users (audit finding S-1).

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!session) {
    // Preserve where the user was headed so we can return them post-login.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
