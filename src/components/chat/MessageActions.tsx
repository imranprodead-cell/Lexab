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
  // blob-кэш прослушанного (повтор бесплатен). С TTL: иначе вкладка вечно
  // играла бы звук, синтезированный до серверных фиксов озвучки.
  const audioCacheRef = useRef<{ url: string; at: number } | null>(null);
  const AUDIO_CACHE_TTL_MS = 15 * 60 * 1000;
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
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src'); // прерывает докачку стрима
        audio.load();
      }
      if (audioCacheRef.current) URL.revokeObjectURL(audioCacheRef.current.url);
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

  // Copy/download intentionally keep the RAW markdown source (not the rendered
  // look) — pasting into an editor preserves the structure, as in ChatGPT.
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

  /** Кэшированный blob-URL, если не протух; протухший — освобождается. */
  const freshCachedUrl = () => {
    const c = audioCacheRef.current;
    if (!c) return null;
    if (Date.now() - c.at > AUDIO_CACHE_TTL_MS) {
      URL.revokeObjectURL(c.url);
      audioCacheRef.current = null;
      return null;
    }
    return c.url;
  };

  const stopSpeaking = () => {
    speechSeq.current++; // a loading request that resolves later must not start playback
    abortRef.current?.abort(); // don't let a cancelled synthesis keep running (it's billed)
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      // removeAttribute + load aborts the in-flight stream download; src=''
      // would resolve to the page URL and can fire a bogus request/error.
      audio.removeAttribute('src');
      audio.load();
    }
    audioRef.current = null;
    if (activeNarration === narrationHandle.current) activeNarration = null;
    setSpeech('idle');
  };
  narrationHandle.current.stop = stopSpeaking;

  /** Streaming playback via MediaSource: fetch pulls the chunked MP3 (works
   *  reliably everywhere fetch works) and bytes are appended to a SourceBuffer
   *  as they arrive — a plain `audio.src = streamUrl` is NOT used because
   *  Chrome closes chunked no-Content-Length media connections after the first
   *  burst and plays only the first sentence (observed live). */
  const canStreamMse = () =>
    typeof window !== 'undefined' && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg');

  const playViaMse = async (audio: HTMLAudioElement, seq: number, markPlaying: () => void): Promise<void> => {
    abortRef.current = new AbortController();
    const res = await ttsApi.stream(text, abortRef.current.signal); // resolves when the first chunk is ready
    if (seq !== speechSeq.current) {
      void res.body?.cancel().catch(() => {});
      return;
    }
    if (!res.body) throw new Error('tts stream: empty body');
    const ms = new MediaSource();
    const msUrl = URL.createObjectURL(ms);
    const opened = new Promise<void>((resolve) => {
      ms.addEventListener('sourceopen', () => resolve(), { once: true });
      setTimeout(resolve, 3000); // стоп/детач в микроокне не должен подвесить промис навсегда
    });
    audio.src = msUrl;
    await opened;
    URL.revokeObjectURL(msUrl); // элемент уже держит источник
    if (seq !== speechSeq.current || ms.readyState !== 'open') {
      void res.body.cancel().catch(() => {});
      return;
    }
    const sb = ms.addSourceBuffer('audio/mpeg');
    const append = (data: Uint8Array) =>
      new Promise<void>((resolve, reject) => {
        const onErr = () => {
          sb.removeEventListener('updateend', onEnd);
          reject(new Error('mse append error'));
        };
        const onEnd = () => {
          sb.removeEventListener('error', onErr);
          resolve();
        };
        sb.addEventListener('updateend', onEnd, { once: true });
        sb.addEventListener('error', onErr, { once: true });
        sb.appendBuffer(data as BufferSource);
      });
    const reader = res.body.getReader();
    const collected: BlobPart[] = [];
    let started = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (seq !== speechSeq.current) {
          void reader.cancel().catch(() => {});
          return;
        }
        if (done) break;
        collected.push(value);
        await append(value);
        if (!started) {
          started = true;
          await audio.play();
          if (seq !== speechSeq.current) {
            audio.pause();
            return;
          }
          markPlaying();
        }
      }
      if (!started) throw new Error('tts stream: пусто'); // защита от 200 без байт
      if (ms.readyState === 'open') ms.endOfStream();
      // Кэш на повтор (только ПОЛНЫЙ ролик — обрезанный сюда не доходит:
      // сервер рвёт соединение destroy-ем, и read() выше бросает).
      if (!audioCacheRef.current) {
        audioCacheRef.current = { url: URL.createObjectURL(new Blob(collected, { type: 'audio/mpeg' })), at: Date.now() };
      }
    } catch (err) {
      // Сбой MSE/сети: ОБЯЗАТЕЛЬНО рвём скачивание — иначе сервер продолжит
      // синтезировать (и платить) в уже ненужное соединение (находка аудита).
      void reader.cancel().catch(() => {});
      if (!started) {
        abortRef.current?.abort();
        throw err; // уйдём в blob-фолбэк
      }
      // После старта — мягко: пусть доиграет буферизованное.
      try {
        if (ms.readyState === 'open') ms.endOfStream();
      } catch {
        /* источник уже отсоединён (стоп) */
      }
    }
  };

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
    const done = () => {
      if (seq === speechSeq.current) {
        audioRef.current = null;
        if (activeNarration === narrationHandle.current) activeNarration = null;
        setSpeech('idle');
      }
    };
    const markPlaying = () => {
      audio.onended = done;
      audio.onerror = done;
      setSpeech('playing');
    };
    // Path 0: локальный кэш прошлого прослушивания — мгновенно и бесплатно.
    // Path 1: MSE-стрим — звук после синтеза первого короткого куска (~2–3 с).
    try {
      const cached = freshCachedUrl();
      if (cached) {
        audio.onended = done;
        audio.onerror = done;
        audio.src = cached;
        await audio.play();
        if (seq !== speechSeq.current) {
          audio.pause();
          return;
        }
        setSpeech('playing');
        return;
      }
      if (!canStreamMse()) throw new Error('mse unsupported');
      await playViaMse(audio, seq, markPlaying);
    } catch {
      if (seq !== speechSeq.current) return;
      // Stop any stream leftovers BEFORE falling back — no double audio/traffic.
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      // Path 2: silent fallback to the whole-file blob (Safari without MP3
      // MediaSource support, demo mode, or an older server).
      try {
        let url = freshCachedUrl();
        if (!url) {
          abortRef.current?.abort(); // добить возможный живой стрим-запрос
          abortRef.current = new AbortController();
          const blob = await ttsApi.synthesize(text, abortRef.current.signal);
          if (seq !== speechSeq.current) return;
          url = URL.createObjectURL(blob);
          audioCacheRef.current = { url, at: Date.now() };
        }
        audio.onended = done;
        audio.onerror = done;
        audio.src = url;
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
    }
  };

  const downloadTxt = () => {
    setMenuOpen(false);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, 'Lexab_reply.txt');
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
