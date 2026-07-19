import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useDismissable } from '@/hooks/useAsync';
import { downloadBlob } from '@/lib/download';
import { useI18n } from '@/i18n/I18nProvider';
import { useUIStore } from '@/store/useUIStore';
import type { ChatMessage } from '@/types/domain';
import styles from './chat.module.css';

interface MessageActionsProps {
  message: ChatMessage;
  /** Persist a thumbs rating (store handles optimistic update + rollback). */
  onFeedback: (messageId: string, value: 'up' | 'down' | null) => void;
}

/**
 * Action row under a finished assistant reply: thumbs up/down, copy and a
 * small overflow menu (read aloud, download as .txt). Icon-only buttons carry
 * aria-labels and tooltips; touch targets expand to 44px on coarse pointers.
 * While narration plays, a visible stop button joins the row.
 */
export function MessageActions({ message, onFeedback }: MessageActionsProps) {
  const { t, lang } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const menuRef = useDismissable<HTMLDivElement>(() => setMenuOpen(false), menuOpen);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakingRef = useRef(false); // survives cleanup — did THIS message start speech?

  // Unmount only: clear the copy-revert timer and stop narration this
  // message started (speechSynthesis is a global channel).
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
      if (speakingRef.current && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    [],
  );

  // Keyboard support for the overflow menu: focus its first item on open.
  useEffect(() => {
    if (!menuOpen) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
  }, [menuOpen, menuRef]);

  const text = message.text ?? '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      pushToast(t('chat.act.copied'), 'success');
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      pushToast(t('common.error'), 'error');
    }
  };

  const rate = (value: 'up' | 'down') => {
    const next = message.feedback === value ? null : value;
    onFeedback(message.id, next);
    if (next) pushToast(t('chat.act.thanks'), 'success');
  };

  const stopSpeaking = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
  };

  const speak = () => {
    setMenuOpen(false);
    if (!('speechSynthesis' in window)) return;
    if (speaking) {
      stopSpeaking();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'ru' ? 'ru-RU' : 'en-US';
    utterance.onend = () => {
      speakingRef.current = false;
      setSpeaking(false);
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      setSpeaking(false);
    };
    window.speechSynthesis.cancel(); // one narration at a time
    window.speechSynthesis.speak(utterance);
    speakingRef.current = true;
    setSpeaking(true);
  };

  const downloadTxt = () => {
    setMenuOpen(false);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, 'LexAI_reply.txt');
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setMenuOpen(false);
      menuBtnRef.current?.focus(); // return focus instead of dropping to <body>
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next].focus();
  };

  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  return (
    <div className={styles.msgActions}>
      <button
        type="button"
        className={`${styles.msgActionBtn} ${message.feedback === 'up' ? styles.msgActionOn : ''}`}
        aria-label={t('chat.act.like')}
        aria-pressed={message.feedback === 'up'}
        title={t('chat.act.like')}
        onClick={() => rate('up')}
      >
        <Icon name="thumbsUp" size={15} />
      </button>
      <button
        type="button"
        className={`${styles.msgActionBtn} ${message.feedback === 'down' ? styles.msgActionOn : ''}`}
        aria-label={t('chat.act.dislike')}
        aria-pressed={message.feedback === 'down'}
        title={t('chat.act.dislike')}
        onClick={() => rate('down')}
      >
        <Icon name="thumbsDown" size={15} />
      </button>
      <button
        type="button"
        className={styles.msgActionBtn}
        aria-label={t('chat.act.copy')}
        title={t('chat.act.copy')}
        onClick={() => void copy()}
      >
        <Icon name={copied ? 'check' : 'copy'} size={15} />
      </button>

      {speaking ? (
        <button
          type="button"
          className={`${styles.msgActionBtn} ${styles.msgActionOn}`}
          aria-label={t('chat.act.speakStop')}
          title={t('chat.act.speakStop')}
          onClick={stopSpeaking}
        >
          <Icon name="volume" size={15} />
        </button>
      ) : null}

      <div className={styles.msgMenuWrap} ref={menuRef} onKeyDown={onMenuKeyDown}>
        <button
          ref={menuBtnRef}
          type="button"
          className={`${styles.msgActionBtn} ${menuOpen ? styles.msgActionOn : ''}`}
          aria-label={t('chat.act.more')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={t('chat.act.more')}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Icon name="dots" size={15} />
        </button>
        {menuOpen ? (
          <div className={styles.msgMenu} role="menu" data-popover-layer>
            {speechSupported ? (
              <button type="button" role="menuitem" className={styles.msgMenuItem} onClick={speak}>
                <Icon name="volume" size={15} />
                {speaking ? t('chat.act.speakStop') : t('chat.act.speak')}
              </button>
            ) : null}
            <button type="button" role="menuitem" className={styles.msgMenuItem} onClick={downloadTxt}>
              <Icon name="download" size={15} />
              {t('chat.act.downloadTxt')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
