import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/icons/Icon';
import { GlassCard } from '@/components/ui/GlassCard';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useI18n } from '@/i18n/I18nProvider';
import { COMMANDS } from '@/data/seed';
import type { Command } from '@/types/domain';
import { SlashMenu } from './SlashMenu';
import styles from './chat.module.css';

interface ChatInputProps {
  compact?: boolean;
  /** Fired for /analyze or the attach button. */
  onAnalyze: () => void;
  /** Fired for a plain (non-command) submitted message. */
  onSend?: (text: string) => void;
  /** When provided, the attach button opens a file picker and passes the chosen file here. */
  onFile?: (file: File) => void;
}

/**
 * The chat composer: auto-growing textarea, attach button, and slash-command
 * autocomplete with full keyboard control (↑/↓ to move, ↵ to pick, Esc to close).
 */
export function ChatInput({ compact = false, onAnalyze, onSend, onFile }: ChatInputProps) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const micBaseRef = useRef('');

  const onAttach = () => {
    if (onFile) fileInputRef.current?.click();
    else onAnalyze();
  };

  const applyValue = useCallback((next: string) => {
    setValue(next);
    setSlashOpen(next.startsWith('/') && !next.includes(' '));
    setSlashIndex(0);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
    }
  }, []);

  const voice = useVoiceInput(
    useCallback((transcript: string) => applyValue(micBaseRef.current + transcript), [applyValue]),
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

  const pick = (command: Command) => {
    if (command.cmd === '/analyze') {
      setValue('');
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
      setValue('');
      onAnalyze();
      return;
    }
    onSend?.(trimmed);
    setValue('');
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
            title="Attach contract"
            aria-label="Attach contract"
            onClick={onAttach}
            className={styles.attachBtn}
          >
            <Icon name="plus" size={22} />
          </button>

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
              aria-label={voice.listening ? 'Остановить запись' : 'Голосовой ввод'}
              title={voice.listening ? 'Остановить запись' : 'Голосовой ввод'}
              onClick={onMic}
              style={{ color: voice.listening ? 'var(--accent)' : 'var(--dim)' }}
              data-listening={voice.listening ? 'true' : undefined}
            >
              <Icon name="mic" size={20} />
            </button>
          ) : null}

          <button
            type="button"
            className={styles.sendBtn}
            aria-label="Send message"
            onClick={submit}
            style={{
              background: hasText ? 'var(--accent)' : 'var(--hover-2)',
              color: hasText ? 'var(--on-accent)' : 'var(--mut)',
            }}
          >
            <Icon name="send" size={18} strokeWidth={2} />
          </button>
        </GlassCard>

        <div className={styles.disclaimer}>{t('chat.disclaimer')}</div>
      </div>
    </div>
  );
}
