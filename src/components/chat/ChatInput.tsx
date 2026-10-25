import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { promptsApi } from '@/api/prompts.api';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useI18n } from '@/i18n/I18nProvider';
import { useUIStore } from '@/store/useUIStore';
import { COMMANDS } from '@/data/seed';
import { ATTACH_ACCEPT } from '@/lib/docFormats';
import type { Command } from '@/types/domain';
import { SlashMenu } from './SlashMenu';
import { AttachmentChip, type ComposerAttachment } from './Attachments';
import styles from './chat.module.css';

/* Unsent text survives page switches (and reloads) until it is sent. */
const DRAFTS_KEY = 'lexai.drafts';

/** Потолок высоты поля ввода: плашка растёт вместе с текстом до половины
 *  экрана (не меньше 320px, не больше 560px) — длинный запрос читается
 *  целиком, дальше включается внутренняя прокрутка. Точное зеркало CSS
 *  max-height: clamp(320px, 50vh, 560px). */
const composerCap = () =>
  typeof window === 'undefined' ? 320 : Math.max(320, Math.min(Math.round(window.innerHeight * 0.5), 560));

/** Потолок текста для кнопки ✦ — совпадает с серверным лимитом /prompts/improve. */
const IMPROVE_MAX_CHARS = 4000;

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
  /** Fired for a plain (non-command) submitted message. Пустая строка — когда
   *  отправляют одни прикреплённые файлы. Вернуть false — отправка не принята
   *  (файлы ещё грузятся): текст остаётся в поле. */
  onSend?: (text: string) => boolean | void;
  /** Файлы, прикреплённые к полю ввода (карточки над текстом). */
  attachments?: ComposerAttachment[];
  onRemoveAttachment?: (key: string) => void;
  /** Подсказка в пустом поле вместо обычной (например, когда прикреплён файл). */
  placeholder?: string;
  /** When provided, the attach button opens a file picker and passes the chosen
   *  files here: один документ или несколько фото страниц договора. */
  onFiles?: (files: File[]) => void;
  /** When provided, a cloud button opens the Google Drive / M365 / Dropbox import. */
  onCloudImport?: () => void;
  /** Storage slot for the unsent draft (chat and workspace keep separate drafts). */
  draftKey?: string;
  /** Спрятать кнопку «Прикрепить»: в воркспейсе она проваливалась в onAnalyze
   *  (= платный повторный анализ) — ловушка под видом скрепки. */
  hideAttach?: boolean;
  /** Optional slot rendered above the input bar (e.g. the Free-plan upsell). */
  banner?: ReactNode;
  /** Без внешней рамки-дока: позицией и шириной управляет родитель (нужно
   *  для layoutId-переезда композера welcome → низ, эталон app/page.tsx). */
  bare?: boolean;
  /** Спрятать подпись «может ошибаться»: на welcome-экране она стоит ниже
   *  карточек (эталон), а не под плашкой. */
  hideDisclaimer?: boolean;
  /** Выбор юрисдикции в нижнем ряду рядом с «Файлы» (чат передаёт CountrySelector). */
  jurisdiction?: ReactNode;
}

/**
 * The chat composer: auto-growing textarea, attach button, and slash-command
 * autocomplete with full keyboard control (↑/↓ to move, ↵ to pick, Esc to close).
 */
export function ChatInput({ compact = false, onAnalyze, onSend, onFiles, onCloudImport, draftKey = 'chat', hideAttach = false, banner, bare = false, hideDisclaimer = false, jurisdiction, attachments = [], onRemoveAttachment, placeholder }: ChatInputProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(() => loadDraft(draftKey));
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [improving, setImproving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const micBaseRef = useRef('');
  const improveAbortRef = useRef<AbortController | null>(null);

  // Leaving the page mid-improve must not leak the request.
  useEffect(() => () => improveAbortRef.current?.abort(), []);

  /** Единственная точка измерения высоты плашки. */
  const measureHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(composerCap(), ta.scrollHeight)}px`;
  }, []);

  // Высота следует за ЗНАЧЕНИЕМ, а не за нажатием клавиши: программные записи
  // (результат ✦, диктовка, восстановленный черновик) должны растить плашку
  // так же, как печать. useLayoutEffect замеряет ПОСЛЕ обновления DOM новым
  // текстом, но до отрисовки — замер по старому содержимому исключён.
  useLayoutEffect(() => {
    measureHeight();
  }, [value, measureHeight]);

  // Смена размера окна меняет потолок (50vh) — перемеряем без нажатий клавиш.
  useEffect(() => {
    window.addEventListener('resize', measureHeight);
    return () => window.removeEventListener('resize', measureHeight);
  }, [measureHeight]);

  const onAttach = () => {
    if (onFiles) fileInputRef.current?.click();
    else onAnalyze();
  };

  const applyValue = useCallback(
    (next: string) => {
      setValue(next);
      saveDraft(draftKey, next);
      setSlashOpen(next.startsWith('/') && !next.includes(' '));
      setSlashIndex(0);
      // Высоту меряет layout-эффект на [value] — здесь замер был бы по
      // СТАРОМУ DOM (React 18 батчит setValue в программных путях).
    },
    [draftKey],
  );

  // «Обсудить в чате» с карточки находки: вопрос кладётся прямо в плашку
  // (событие, а не проп — карточки живут в другой ветке дерева). Черновик
  // НЕ отправляется сам: пользователь дочитывает, правит и жмёт отправить.
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent<{ draftKey?: string; text?: string }>).detail;
      if (!detail || detail.draftKey !== draftKey || !detail.text) return;
      applyValue(detail.text);
      textareaRef.current?.focus();
    };
    window.addEventListener('lexab:composer-prefill', onPrefill);
    return () => window.removeEventListener('lexab:composer-prefill', onPrefill);
  }, [draftKey, applyValue]);

  const pushToast = useUIStore((s) => s.pushToast);
  const voice = useVoiceInput(
    useCallback((transcript: string) => applyValue(micBaseRef.current + transcript), [applyValue]),
    useCallback(() => pushToast(t('chat.micDenied'), 'error'), [pushToast, t]),
  );

  const onMic = () => {
    if (improving) return; // диктовка поверх работающего ✦ молча теряла бы текст
    if (!voice.listening) micBaseRef.current = value ? `${value.replace(/\s*$/, '')} ` : '';
    voice.toggle();
  };

  /** ✦: rewrite the draft into a clear prompt and put it back into the box. */
  const onImprove = async () => {
    const draft = value.trim();
    if (!draft || !improveReady || improving) return;
    if (voice.listening) voice.toggle(); // остановить диктовку — иначе поздний transcript перезапишет результат ✦
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

  // Выбранная команда видна плашкой, а не текстом «/draft »: в value она
  // остаётся префиксом, поэтому отправка, черновик, ✦ и диктовка не меняются.
  const chip = useMemo(() => COMMANDS.find((c) => value.startsWith(`${c.cmd} `)) ?? null, [value]);
  const chipPrefix = chip ? `${chip.cmd} ` : '';
  const shownValue = value.slice(chipPrefix.length);

  const updateValue = (next: string) => {
    applyValue(next);
  };

  const clearValue = () => {
    setValue('');
    saveDraft(draftKey, '');
    // Схлопывание к одной строке делает layout-эффект на [value].
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
    // Без текста отправляются только прикреплённые файлы.
    if (!trimmed && !attachments.length) return;
    if (trimmed.startsWith('/analyze')) {
      clearValue();
      onAnalyze();
      return;
    }
    if (onSend?.(trimmed) === false) return;
    clearValue();
    setSlashOpen(false);
  };

  /** Cmd/Ctrl+V файла (скриншот, файл из Finder) — прикрепить, как через «Файлы». */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onFiles || hideAttach) return;
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    onFiles(files);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Backspace в самом начале строки снимает плашку команды, текст остаётся.
    if (chip && !improving && e.key === 'Backspace') {
      const ta = e.currentTarget;
      if (ta.selectionStart === 0 && ta.selectionEnd === 0) {
        e.preventDefault();
        updateValue(shownValue);
        return;
      }
    }
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
  const canSend = hasText || attachments.length > 0;
  // ✦ активна только когда пользователь реально описал запрос (≥5 слов) —
  // на обрывке из пары слов модели нечего улучшать, она начнёт додумывать.
  // И не длиннее серверного лимита — иначе кнопка выглядит рабочей, а сервер
  // отвечает 400 с непонятным для пользователя тостом.
  const improveTooLong = value.trim().length > IMPROVE_MAX_CHARS;
  const improveReady = value.trim().split(/\s+/).filter(Boolean).length >= 5 && !improveTooLong;
  const improveHint = improveTooLong ? t('chat.improveLong') : hasText && !improveReady ? t('chat.improveShort') : t('chat.improve');

  return (
    <div className={bare ? styles.composerBare : `${styles.composer} ${compact ? styles.composerCompact : ''}`}>
      <div className={`${styles.composerInner} ${compact || bare ? styles.composerInnerFull : ''}`}>
        {slashOpen ? (
          <SlashMenu commands={filtered} activeIndex={slashIndex} onHover={setSlashIndex} onPick={pick} />
        ) : null}

        {banner}

        {/* ChatGPT-style two-row pill: the textarea spans the FULL width on
            top (no side gutters squeezing long prompts), the buttons live in
            their own row underneath — attach/cloud left, ✦/mic/send right.
            Панель эталона (bg-surface + бордер) вместо стекла — см. .inputBar. */}
        <div className={styles.inputBar}>
          {/* Фото: на телефоне image/* добавляет в выбор «Снять фото» — договор
              можно сфотографировать постранично прямо отсюда. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={`${ATTACH_ACCEPT},.jpg,.jpeg,.png,.webp,.heic,.heif,image/*`}
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) onFiles?.(files);
              e.target.value = ''; // allow re-selecting the same file
            }}
          />

          {attachments.length ? (
            <div className={styles.attRow}>
              {attachments.map((a) => (
                <AttachmentChip
                  key={a.key}
                  name={a.name}
                  size={a.size}
                  status={a.status}
                  onRemove={onRemoveAttachment ? () => onRemoveAttachment(a.key) : undefined}
                />
              ))}
            </div>
          ) : null}

          {/* Обёртка есть всегда: если бы она появлялась только с плашкой,
              React пересоздал бы textarea и курсор терял бы фокус. */}
          <div className={styles.inputTextRow}>
            {chip ? (
              <span className={styles.cmdChip} data-tone={chip.cmd.slice(1)}>
                <Icon name={chip.icon as IconName} size={15} strokeWidth={1.8} />
                <span className={styles.cmdChipLabel}>{chip.cmd.slice(1)}</span>
              </span>
            ) : null}
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              rows={1}
              value={shownValue}
              placeholder={chip ? '' : (placeholder ?? t('chat.input.placeholder'))}
              onChange={(e) => updateValue(chipPrefix + e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              aria-label={t('a11y.messageInput')}
              data-chat-input
              readOnly={improving}
            />
          </div>

          {/* Нижний ряд: слева «Файлы · облако · страна · Улучшить» (кнопки с
              подписями), справа микрофон и отправка. На узком поле подписи
              прячутся, остаются иконки (container query в chat.module.css). */}
          <div className={styles.inputControlsRow}>
            <div className={`${styles.inputControlsGroup} ${styles.toolGroup}`}>
              {hideAttach ? null : (
                <button
                  type="button"
                  title={t('chat.attach')}
                  aria-label={t('chat.attach')}
                  onClick={onAttach}
                  className={styles.toolBtn}
                >
                  <Icon name="attach" size={16} />
                  <span className={styles.toolLabel}>{t('chat.filesLabel')}</span>
                </button>
              )}

              {onCloudImport ? (
                <button
                  type="button"
                  title={t('cloud.title')}
                  aria-label={t('cloud.title')}
                  onClick={onCloudImport}
                  className={`${styles.toolBtn} ${styles.toolBtnIcon}`}
                >
                  <Icon name="cloud" size={17} />
                </button>
              ) : null}

              {jurisdiction}

              <button
                type="button"
                className={styles.toolBtn}
                aria-label={t('chat.improve')}
                title={improveHint}
                onClick={onImprove}
                disabled={!improveReady || improving}
                style={{ color: improving ? 'var(--accent)' : undefined, opacity: improveReady || improving ? 1 : 0.45 }}
              >
                {improving ? <Spinner size={15} /> : <Icon name="wand" size={16} />}
                <span className={styles.toolLabel}>{t('chat.improveLabel')}</span>
              </button>
            </div>

            <div className={styles.inputControlsGroup}>
            {voice.supported ? (
              <button
                type="button"
                className={styles.micBtn}
                aria-label={voice.listening ? t('chat.micStop') : t('chat.micStart')}
                title={voice.listening ? t('chat.micStop') : t('chat.micStart')}
                onClick={onMic}
                disabled={improving}
                style={{ color: voice.listening ? 'var(--accent)' : 'var(--dim)', opacity: improving ? 0.45 : 1 }}
                data-listening={voice.listening ? 'true' : undefined}
              >
                <Icon name="mic" size={18} />
              </button>
            ) : null}

              {/* Единственная тёмная кнопка чата: графит + shimmer по hover. */}
              <button
                type="button"
                className={`${styles.sendBtn} btn-shimmer`}
                aria-label={t('chat.sendLabel')}
                onClick={submit}
                style={{
                  background: canSend ? 'var(--accent)' : 'var(--hover-2)',
                  color: canSend ? 'var(--on-accent)' : 'var(--mut)',
                }}
              >
                <Icon name="send" size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>

        {hideDisclaimer ? null : <div className={styles.disclaimer}>{t('chat.disclaimer')}</div>}
      </div>
    </div>
  );
}
