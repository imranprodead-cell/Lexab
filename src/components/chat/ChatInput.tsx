import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '@/components/icons/Icon';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { promptsApi } from '@/api/prompts.api';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useI18n } from '@/i18n/I18nProvider';
import { useUIStore } from '@/store/useUIStore';
import { COMMANDS } from '@/data/seed';
import type { Command } from '@/types/domain';
import { SlashMenu } from './SlashMenu';
import styles from './chat.module.css';

/* Unsent text survives page switches (and reloads) until it is sent. */
const DRAFTS_KEY = 'lexai.drafts';

/** Потолок высоты поля ввода — большая «плашка», длинный промпт читается
 *  целиком (дальше — внутренняя прокрутка). Синхронен с max-height в CSS. */
const MAX_COMPOSER_HEIGHT = 320;

function loadDraft(key: string): string {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') as Record<string, string>;
    return typeof all[key] === 'string' ? all[key] : '';
  } catch {
    return '';
  }
}

function saveDraft(key: string, text: string) {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') as Record<string, string>;
    if (text) all[key] = text;
    else delete all[key];
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked — draft lives only until unmount */
  }
}

interface ChatInputProps {
  compact?: boolean;
  /** Fired for /analyze or the attach button. */
  onAnalyze: () => void;
  /** Fired for a plain (non-command) submitted message. */
  onSend?: (text: string) => void;
  /** When provided, the attach button opens a file picker and passes the chosen file here. */
  onFile?: (file: File) => void;
  /** When provided, a cloud button opens the Google Drive / M365 / Dropbox import. */
  onCloudImport?: () => void;
  /** Storage slot for the unsent draft (chat and workspace keep separate drafts). */
  draftKey?: string;
  /** Ghost mode: never touch localStorage — the draft dies with the canvas. */
  ephemeral?: boolean;
  /** Optional slot rendered above the input bar (e.g. the Free-plan upsell). */
  banner?: ReactNode;
}

/**
 * The chat composer: auto-growing textarea, attach button, and slash-command
 * autocomplete with full keyboard control (↑/↓ to move, ↵ to pick, Esc to close).
 */
export function ChatInput({ compact = false, onAnalyze, onSend, onFile, onCloudImport, draftKey = 'chat', ephemeral = false, banner }: ChatInputProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(() => (ephemeral ? '' : loadDraft(draftKey)));
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [improving, setImproving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const micBaseRef = useRef('');
  const improveAbortRef = useRef<AbortController | null>(null);

  // Leaving the page mid-improve must not leak the request.
  useEffect(() => () => improveAbortRef.current?.abort(), []);

  // A restored draft can be multi-line — size the textarea to it on mount.
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta && ta.value) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(MAX_COMPOSER_HEIGHT, ta.scrollHeight)}px`;
    }
  }, []);

  const onAttach = () => {
    if (onFile) fileInputRef.current?.click();
    else onAnalyze();
  };

  const applyValue = useCallback(
    (next: string) => {
      setValue(next);
      if (!ephemeral) saveDraft(draftKey, next);
      setSlashOpen(next.startsWith('/') && !next.includes(' '));
      setSlashIndex(0);
      const ta = textareaRef.current;
      if (ta) {
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(MAX_COMPOSER_HEIGHT, ta.scrollHeight)}px`;
      }
    },
    [draftKey, ephemeral],
  );

  const pushToast = useUIStore((s) => s.pushToast);
  const voice = useVoiceInput(
    useCallback((transcript: string) => applyValue(micBaseRef.current + transcript), [applyValue]),
    useCallback(() => pushToast(t('chat.micDenied'), 'error'), [pushToast, t]),
  );

  const onMic = () => {
    if (!voice.listening) micBaseRef.current = value ? `${value.replace(/\s*$/, '')} ` : '';
    voice.toggle();
  };

  /** ✦: rewrite the draft into a clear prompt and put it back into the box. */
  const onImprove = async () => {
    const draft = value.trim();
    if (!draft || !improveReady || improving) return;
    improveAbortRef.current?.abort();
    const controller = new AbortController();
    improveAbortRef.current = controller;
    setImproving(true);
    try {
      const better = await promptsApi.improve(draft, controller.signal);
      if (!controller.signal.aborted && better.trim()) {
        applyValue(better.trim());
        textareaRef.current?.focus();
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        pushToast(t('chat.improveError'), 'error');
      }
    } finally {
      if (improveAbortRef.current === controller) improveAbortRef.current = null;
      setImproving(false);
    }
  };

  const filtered = useMemo<Command[]>(() => {
    const q = value.toLowerCase();
    return COMMANDS.filter((c) => c.cmd.startsWith(q));
  }, [value]);

  const updateValue = (next: string) => {
    applyValue(next);
  };

  const clearValue = () => {
    setValue('');
    if (!ephemeral) saveDraft(draftKey, '');
    // Collapse back to a single line — a tall textarea must not stay tall
    // (deformed pill) after the long message it held was sent or cleared.
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  /** Consuming the draft (send / slash-pick) must kill an in-flight improve —
   *  otherwise its late result would REFILL the just-cleared composer. */
  const cancelImprove = () => {
    improveAbortRef.current?.abort();
    improveAbortRef.current = null;
  };

  const pick = (command: Command) => {
    cancelImprove();
    if (command.cmd === '/analyze') {
      clearValue();
      setSlashOpen(false);
      onAnalyze();
      return;
    }
    updateValue(`${command.cmd} `);
    setSlashOpen(false);
    textareaRef.current?.focus();
  };

  const submit = () => {
    cancelImprove();
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('/analyze')) {
      clearValue();
      onAnalyze();
      return;
    }
    onSend?.(trimmed);
    clearValue();
    setSlashOpen(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        pick(filtered[slashIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setSlashOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const hasText = value.trim().length > 0;
  // ✦ активна только когда пользователь реально описал запрос (≥5 слов) —
  // на обрывке из пары слов модели нечего улучшать, она начнёт додумывать.
  const improveReady = value.trim().split(/\s+/).filter(Boolean).length >= 5;

  return (
    <div className={`${styles.composer} ${compact ? styles.composerCompact : ''}`}>
      <div className={`${styles.composerInner} ${compact ? styles.composerInnerFull : ''}`}>
        {slashOpen ? (
          <SlashMenu commands={filtered} activeIndex={slashIndex} onHover={setSlashIndex} onPick={pick} />
        ) : null}

        {banner}

        {/* ChatGPT-style two-row pill: the textarea spans the FULL width on
            top (no side gutters squeezing long prompts), the buttons live in
            their own row underneath — attach/cloud left, ✦/mic/send right. */}
        <GlassCard className={styles.inputBar}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile?.(file);
              e.target.value = ''; // allow re-selecting the same file
            }}
          />

          <textarea
            ref={textareaRef}
            className={styles.textarea}
            rows={1}
            value={value}
            placeholder={t('chat.input.placeholder')}
            onChange={(e) => updateValue(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label={t('a11y.messageInput')}
            data-chat-input
            readOnly={improving}
          />

          <div className={styles.inputControlsRow}>
            <div className={styles.inputControlsGroup}>
              <button
                type="button"
                title={t('chat.attach')}
                aria-label={t('chat.attach')}
                onClick={onAttach}
                className={styles.attachBtn}
              >
                <Icon name="plus" size={20} />
              </button>

              {onCloudImport ? (
                <button
                  type="button"
                  title={t('cloud.title')}
                  aria-label={t('cloud.title')}
                  onClick={onCloudImport}
                  className={styles.attachBtn}
                >
                  <Icon name="cloud" size={18} />
                </button>
              ) : null}
            </div>

            <div className={styles.inputControlsGroup}>
            <button
              type="button"
              className={styles.micBtn}
              aria-label={t('chat.improve')}
              title={hasText && !improveReady ? t('chat.improveShort') : t('chat.improve')}
              onClick={onImprove}
              disabled={!improveReady || improving}
              style={{ color: improving ? 'var(--accent)' : 'var(--dim)', opacity: improveReady || improving ? 1 : 0.45 }}
            >
              {improving ? <Spinner size={16} /> : <Icon name="sparkle" size={18} />}
            </button>

            {voice.supported ? (
              <button
                type="button"
                className={styles.micBtn}
                aria-label={voice.listening ? t('chat.micStop') : t('chat.micStart')}
                title={voice.listening ? t('chat.micStop') : t('chat.micStart')}
                onClick={onMic}
                style={{ color: voice.listening ? 'var(--accent)' : 'var(--dim)' }}
                data-listening={voice.listening ? 'true' : undefined}
              >
                <Icon name="mic" size={18} />
              </button>
            ) : null}

              <button
                type="button"
                className={styles.sendBtn}
                aria-label={t('chat.sendLabel')}
                onClick={submit}
                style={{
                  background: hasText ? 'var(--accent)' : 'var(--hover-2)',
                  color: hasText ? 'var(--on-accent)' : 'var(--mut)',
                }}
              >
                <Icon name="send" size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
        </GlassCard>

        <div className={styles.disclaimer}>{t('chat.disclaimer')}</div>
      </div>
    </div>
  );
}
