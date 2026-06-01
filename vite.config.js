import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const ANIMATION_API_TARGET =
  process.env.VITE_ANIMATION_API_URL || 'https://paulita-nonoptimistical-fae.ngrok-free.dev';

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Proxies /animation-proxy/* → ngrok backend (server-to-server: no CORS, no ngrok interstitial)
      '/animation-proxy': {
        target: ANIMATION_API_TARGET,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/animation-proxy/, ''),
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  }
});
