import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

// Error monitoring — enabled only when VITE_SENTRY_DSN is set.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  void import('@sentry/react').then((Sentry) => {
    Sentry.init({ dsn: sentryDsn, tracesSampleRate: 0.1 });
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

// No <StrictMode>: its dev-only double mounting re-ran every page's data
// fetch twice (abort + retry), which doubled perceived navigation latency.
createRoot(container).render(<App />);
