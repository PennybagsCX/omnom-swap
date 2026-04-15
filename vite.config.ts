import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
    proxy: {
      '/api/gecko': {
        target: 'https://api.geckoterminal.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api\/gecko/, '/api/v2'),
      },
      '/api/mexc': {
        target: 'https://api.mexc.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api\/mexc/, ''),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          web3: ['wagmi', 'viem', '@tanstack/react-query'],
          ui: ['lucide-react', 'motion']
        }
      }
    }
  },
  // Strip all console.* methods in production builds — app uses ErrorBoundary + toast notifications for error handling
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console'] : [],
  },
});
