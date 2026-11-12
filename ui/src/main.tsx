import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/lib/auth/auth-context';
import { createApiKeyVerifier } from '@/lib/auth/verify-api-key';
import { config } from '@/lib/config';
import { AgentProvider } from '@/lib/agent-context';
import App from './App';
import './index.css';

const verifyApiKey = createApiKeyVerifier(config.apiBaseUrl);

const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider verifyApiKey={verifyApiKey} authConfigUrl={`${config.apiBaseUrl}/api/auth/config`}>
      <AgentProvider>
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </AgentProvider>
    </AuthProvider>
  </StrictMode>
);
