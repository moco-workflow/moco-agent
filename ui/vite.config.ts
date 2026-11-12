import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_APP_BASE || '/';

  return {
    base,
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 3004,
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
        // The server's RSA public key, for encrypting a secret before upload.
        '/public': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  };
});
