import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ttsApi } from '@/api';
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

// One narration per window (like the old speechSynthesis behaviour): starting
// a message's narration stops whichever other message is currently playing.
let activeNarration: { stop: () => void } | null = null;

/**
 * Action row under a finished assistant reply: thumbs up/down, copy and a
 * small overflow menu (read aloud, download as .txt). Icon-only buttons carry
 * aria-labels and tooltips; touch targets expand to 44px on coarse pointers.
 * Narration is server-synthesized MP3 (POST /tts); the menu item toggles
 * play/stop and the fetched audio is cached per message for replays.
 */
export function MessageActions({ message, onFeedback }: MessageActionsProps) {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [speech, setSpeech] = useState<'idle' | 'loading' | 'playing'>('idle');
  const menuRef = useDismissable<HTMLDivElement>(() => setMenuOpen(false), menuOpen);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speechSeq = useRef(0); // invalidates in-flight requests on stop/unmount
  const abortRef = useRef<AbortController | null>(null);
  const narrationHandle = useRef<{ stop: () => void }>({ stop: () => {} });

  // Unmount only: clear the copy-revert timer, stop playback and release the
  // cached object URL (a blob URL pins the whole MP3 in memory until revoked).
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
      speechSeq.current++;
      abortRef.current?.abort();
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      if (activeNarration === narrationHandle.current) activeNarration = null;
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
    speechSeq.current++; // a loading request that resolves later must not start playback
    abortRef.current?.abort(); // don't let a cancelled synthesis keep running (it's billed)
    audioRef.current?.pause();
    audioRef.current = null;
    if (activeNarration === narrationHandle.current) activeNarration = null;
    setSpeech('idle');
  };
  narrationHandle.current.stop = stopSpeaking;

  const speak = async () => {
    setMenuOpen(false);
    if (speech !== 'idle') {
      stopSpeaking();
      return;
    }
    if (activeNarration && activeNarration !== narrationHandle.current) activeNarration.stop();
    activeNarration = narrationHandle.current;
    const seq = ++speechSeq.current;
    setSpeech('loading');
    // Create the element inside the click gesture and "unlock" it: Safari/iOS
    // rejects play() that only happens after an async fetch. The empty play()
    // fails silently and marks the element as user-activated.
    const audio = new Audio();
    audio.play().catch(() => {});
    audioRef.current = audio;
    try {
      if (!audioUrlRef.current) {
        abortRef.current = new AbortController();
        const blob = await ttsApi.synthesize(text, abortRef.current.signal);
        if (seq !== speechSeq.current) return; // stopped/unmounted while loading
        audioUrlRef.current = URL.createObjectURL(blob);
      }
      const done = () => {
        if (seq === speechSeq.current) {
          audioRef.current = null;
          if (activeNarration === narrationHandle.current) activeNarration = null;
          setSpeech('idle');
        }
      };
      audio.onended = done;
      audio.onerror = done;
      audio.src = audioUrlRef.current;
      await audio.play();
      if (seq !== speechSeq.current) {
        audio.pause();
        return;
      }
      setSpeech('playing');
    } catch {
      if (seq === speechSeq.current) {
        stopSpeaking();
        pushToast(t('chat.act.speakError'), 'error');
      }
    }
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
            <button type="button" role="menuitem" className={styles.msgMenuItem} onClick={() => void speak()}>
              <Icon name="volume" size={15} />
              {speech === 'idle' ? t('chat.act.speak') : t('chat.act.speakStop')}
            </button>
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
