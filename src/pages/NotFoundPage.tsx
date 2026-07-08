import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import styles from './pages.module.css';

/** 404 fallback for unknown routes. */
export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className={styles.page}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          textAlign: 'center',
          padding: 24,
        }}
      >
        <Avatar size={48} />
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '8px 0 0' }}>Page not found</h1>
        <p style={{ color: 'var(--dim)', margin: 0, maxWidth: 360 }}>
          We couldn&rsquo;t find that page. It may have been moved, or the link is out of date.
        </p>
        <Button variant="primary" onClick={() => navigate('/chat')}>
          Back to chat
        </Button>
      </div>
    </div>
  );
}
