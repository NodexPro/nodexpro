import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { PRODUCTION_PUBLIC_API_BASE } from './src/lib/resolve-public-api-base-url.pure';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: { port: 3000 },
  define:
    mode === 'production'
      ? {
          'import.meta.env.VITE_API_URL': JSON.stringify(PRODUCTION_PUBLIC_API_BASE),
        }
      : undefined,
}));
