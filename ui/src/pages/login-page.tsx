import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrandMark } from '@/components/brand-mark';
import { useAuth } from '@/lib/auth/auth-context';
import { useApiKeyLogin } from '@/lib/auth/use-api-key-login';

export function LoginPage() {
  const { login, loginAsGuest, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const adminLogin = useApiKeyLogin(() => navigate('/', { replace: true }));

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm rounded-lg border border-gray-800 bg-gray-900 p-8">
        <BrandMark className="mx-auto mb-4 h-12 w-12" />
        <h1 className="text-xl font-bold text-white text-center mb-6">
          Moco Agent
        </h1>
        <p className="text-gray-400 text-sm text-center mb-6">
          AI-powered moco workflow assistant
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={login}
            className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Sign in with OAuth
          </button>
          <button
            onClick={async () => {
              await loginAsGuest();
              navigate('/', { replace: true });
            }}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-700 transition-colors"
          >
            Continue as Guest
          </button>
        </div>
        {adminLogin.shown && (
          <form
            onSubmit={adminLogin.submit}
            aria-label="Sign in as admin"
            className="mt-6 flex flex-col gap-3 border-t border-gray-800 pt-6"
          >
            <label htmlFor="admin-api-key" className="text-sm font-medium text-gray-300">
              Sign in as admin
            </label>
            <input
              id="admin-api-key"
              type="password"
              autoComplete="off"
              value={adminLogin.apiKey}
              onChange={(e) => adminLogin.setApiKey(e.target.value)}
              placeholder="Admin API key (moco_…)"
              disabled={adminLogin.isSubmitting}
              autoFocus
              required
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            {adminLogin.error && (
              <p role="alert" className="text-sm text-red-400">
                {adminLogin.error}
              </p>
            )}
            <button
              type="submit"
              disabled={adminLogin.isSubmitting || !adminLogin.apiKey.trim()}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {adminLogin.isSubmitting ? 'Signing in…' : 'Sign in with API key'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
