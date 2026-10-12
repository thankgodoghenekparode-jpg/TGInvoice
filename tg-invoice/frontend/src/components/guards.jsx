import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

function FullPageLoader({ label = 'Loading…' }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-canvas">
      <div className="h-8 w-8 rounded-full border-2 border-line border-t-brand animate-spin" />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

/** Blocks access until the session is restored. Redirects guests to /login. */
export function RequireAuth({ children }) {
  const { booting, user } = useAuth();
  const location = useLocation();
  if (booting) return <FullPageLoader label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

/** For auth pages: sends already-logged-in users to the dashboard. */
export function PublicOnly({ children }) {
  const { booting, user, activeTenant } = useAuth();
  if (booting) return <FullPageLoader label="Restoring your session…" />;
  if (user) {
    // A platform admin with no business belongs in the admin area.
    if (user.isPlatformAdmin && !activeTenant) return <Navigate to="/admin" replace />;
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

/** Users with no business yet are sent to the onboarding wizard. */
export function RequiresSetup({ children }) {
  const { booting, user, activeTenant } = useAuth();
  if (booting) return <FullPageLoader label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (!activeTenant) {
    return <Navigate to={user.isPlatformAdmin ? '/admin' : '/onboarding'} replace />;
  }
  return children;
}

/** Platform (super-admin) area — rejects everyone without User.isPlatformAdmin. */
export function RequirePlatformAdmin({ children }) {
  const { booting, user } = useAuth();
  const location = useLocation();
  if (booting) return <FullPageLoader label="Checking access…" />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!user.isPlatformAdmin) return <Navigate to="/dashboard" replace />;
  return children;
}
