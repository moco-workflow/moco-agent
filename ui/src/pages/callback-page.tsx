import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth/auth-context';

export function CallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { handleCallback } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;

    const processCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const errorParam = searchParams.get('error');

      if (errorParam) {
        setError(`OAuth error: ${errorParam}`);
        setTimeout(() => navigate('/login', { replace: true }), 3000);
        return;
      }

      if (!code || !state) {
        setError('Missing authorization code or state');
        setTimeout(() => navigate('/login', { replace: true }), 3000);
        return;
      }

      hasProcessed.current = true;
      try {
        await handleCallback(code, state);
        navigate('/', { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
        setTimeout(() => navigate('/login', { replace: true }), 3000);
      }
    };

    processCallback();
  }, [searchParams, navigate, handleCallback]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      {error ? (
        <div className="text-center">
          <p className="text-red-400 mb-2">{error}</p>
          <p className="text-gray-500 text-sm">Redirecting to login...</p>
        </div>
      ) : (
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-700 border-t-blue-500" />
      )}
    </div>
  );
}
