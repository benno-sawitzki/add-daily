import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

const AuthCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { googleLogin } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError('Google authentication was cancelled or failed');
      setTimeout(() => navigate('/'), 3000);
      return;
    }

    if (code) {
      handleGoogleAuth(code);
    } else {
      navigate('/');
    }
  }, [searchParams]);

  const handleGoogleAuth = async (code) => {
    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      await googleLogin(code, redirectUri);
      navigate('/app');
    } catch (err) {
      console.error('Google auth error:', err);
      setError(err.response?.data?.detail || 'Authentication failed');
      setTimeout(() => navigate('/'), 3000);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 mb-4">{error}</div>
          <div className="text-white/60">Redirecting to home...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin text-purple-500 mx-auto mb-4" />
        <div className="text-white text-lg">Completing sign in...</div>
      </div>
    </div>
  );
};

export default AuthCallback;
