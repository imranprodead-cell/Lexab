/// <reference types="vitest/config" />
import crypto from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Content-Security-Policy for the built SPA (production only — dev keeps Vite's
 * relaxed HMR policy). Injected as a <meta> so it ships with the static files,
 * no host config needed. The point: even if an XSS is ever introduced, the auth
 * token in localStorage can't be exfiltrated — script-src blocks injected
 * scripts (only our hashed inline scripts run), and connect-src/img-src block
 * beaconing it to any non-self, non-Google host.
 */
function cspPlugin(): Plugin {
  const originOf = (v: string | undefined): string | null => {
    if (!v || !/^https?:\/\//.test(v)) return null;
    try {
      return new URL(v).origin;
    } catch {
      return null;
    }
  };
  return {
    name: 'lexab-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Hash every executable inline <script> (skip external src and the
        // non-executable JSON-LD block) so they run, while any injected inline
        // script is refused.
        const scriptHashes: string[] = [];
        const scriptRe =
          /<script(?![^>]*\bsrc=)(?![^>]*\btype=["'](?:application\/(?:ld\+json)|importmap)["'])[^>]*>([\s\S]*?)<\/script>/gi;
        for (let m = scriptRe.exec(html); m; m = scriptRe.exec(html)) {
          scriptHashes.push(`'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
        }
        // Hash inline event handlers (e.g. the async-font onload) so they keep
        // working under a script-src that otherwise forbids inline handlers.
        const handlerHashes: string[] = [];
        const handlerRe = /\son[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
        for (let m = handlerRe.exec(html); m; m = handlerRe.exec(html)) {
          const code = m[1] ?? m[2] ?? '';
          handlerHashes.push(`'sha256-${crypto.createHash('sha256').update(code, 'utf8').digest('base64')}'`);
        }

        const apiOrigin = originOf(process.env.VITE_API_BASE_URL);
        const sentryOrigin = originOf(process.env.VITE_SENTRY_DSN);
        const connect = ["'self'", 'https://*.googleapis.com', 'https://*.google.com', apiOrigin, sentryOrigin].filter(
          Boolean,
        );

        const csp = [
          `default-src 'self'`,
          `base-uri 'self'`,
          `object-src 'none'`,
          `form-action 'self'`,
          `script-src 'self' ${scriptHashes.join(' ')} 'unsafe-hashes' ${handlerHashes.join(' ')} https://apis.google.com https://accounts.google.com https://*.gstatic.com`,
          `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.gstatic.com`,
          `font-src 'self' https://fonts.gstatic.com data:`,
          `img-src 'self' data: blob: https://*.googleusercontent.com https://*.gstatic.com https://*.google.com`,
          // Озвучка: blob: — фолбэк-плеер, apiOrigin — прогрессивный MP3-стрим
          // (без media-src default-src 'self' блокирует ОБА пути в прод-сборке).
          `media-src ${["'self'", 'blob:', apiOrigin].filter(Boolean).join(' ')}`,
          `connect-src ${connect.join(' ')}`,
          `frame-src https://accounts.google.com https://docs.google.com https://drive.google.com https://*.google.com`,
        ].join('; ');

        return html.replace(/<head>/i, `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
      },
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), cspPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Вендоры — отдельными чанками: меняются только при апгрейде
        // зависимостей и кешируются браузером между деплоями (entry-чанк
        // приложения при этом худеет с 780KB до ~410KB). Завершающий [\\/]
        // в каждой ветке обязателен: без него 'react' захватил бы
        // 'react-router', а 'motion' — 'motion-dom'. Catch-all vendor-группы
        // НЕ добавлять: она затянула бы ленивые react-markdown/remark из
        // чанка MarkdownMessage в первую загрузку.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor';
          if (/[\\/]node_modules[\\/](react-router|react-router-dom|@remix-run[\\/]router)[\\/]/.test(id)) return 'router';
          if (/[\\/]node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'motion';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    // Never silently hop to 5174/5175: a second `npm run dev` fails loudly
    // instead of spawning another copy of the app (breaks OAuth returns).
    strictPort: true,
    host: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
