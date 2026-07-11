import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '@/components/icons/Icon';
import { GlassCard } from '@/components/ui/GlassCard';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useI18n } from '@/i18n/I18nProvider';
import { useUIStore } from '@/store/useUIStore';
import { COMMANDS } from '@/data/seed';
import type { Command } from '@/types/domain';
import { SlashMenu } from './SlashMenu';
import styles from './chat.module.css';

/* Unsent text survives page switches (and reloads) until it is sent. */
const DRAFTS_KEY = 'lexai.drafts';

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const micBaseRef = useRef('');

  // A restored draft can be multi-line — size the textarea to it on mount.
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta && ta.value) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
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
        ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
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
  };

  const pick = (command: Command) => {
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

  return (
    <div className={`${styles.composer} ${compact ? styles.composerCompact : ''}`}>
      <div className={`${styles.composerInner} ${compact ? styles.composerInnerFull : ''}`}>
        {slashOpen ? (
          <SlashMenu commands={filtered} activeIndex={slashIndex} onHover={setSlashIndex} onPick={pick} />
        ) : null}

        {banner}

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

          <textarea
            ref={textareaRef}
            className={styles.textarea}
            rows={1}
            value={value}
            placeholder={t('chat.input.placeholder')}
            onChange={(e) => updateValue(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Message LexAI"
          />

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
        </GlassCard>

        <div className={styles.disclaimer}>{t('chat.disclaimer')}</div>
      </div>
    </div>
  );
}
