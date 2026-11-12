import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '@/routes/protected-route';
import { getCallbackRoutePath } from '@/lib/auth/oauth-client';
import { LoginPage } from '@/pages/login-page';
import { CallbackPage } from '@/pages/callback-page';
import { ChatPage } from '@/pages/chat-page';
import { SettingsPage } from '@/pages/settings-page';
import { KnowledgePage } from '@/pages/knowledge-page';
import { MemoryPage } from '@/pages/memory-page';
import { ToolsPage } from '@/pages/tools-page';
import { ActivityPage } from '@/pages/activity-page';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* In a deployed build the console owns the registered callback and
          bounces us home, so this route only serves local dev. */}
      <Route path={getCallbackRoutePath()} element={<CallbackPage />} />
      <Route element={<ProtectedRoute />}>
        <Route index element={<ChatPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="memory" element={<MemoryPage />} />
        <Route path="tools" element={<ToolsPage />} />
        <Route path="activity" element={<ActivityPage />} />
      </Route>
    </Routes>
  );
}
