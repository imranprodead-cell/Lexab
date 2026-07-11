import { useState } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/I18nProvider';
import { pickText } from '@/i18n/messages';

const STORAGE_KEY = 'lexai.onboarded';

interface Step {
  icon: IconName;
  title: { ru: string; en: string };
  body: { ru: string; en: string };
}

const STEPS: Step[] = [
  {
    icon: 'search',
    title: { ru: 'Анализируйте контракты', en: 'Analyze contracts' },
    body: {
      ru: 'Перетащите документ в чат — LexAI разберёт риски и предложит правки со ссылками на закон.',
      en: 'Drop a document into the chat — LexAI surfaces risks and suggests redlines with citations.',
    },
  },
  {
    icon: 'layout',
    title: { ru: 'Рабочая область правок', en: 'Redline workspace' },
    body: {
      ru: 'Принимайте или отклоняйте изменения по одному, экспортируйте DOCX и отправляйте на подпись.',
      en: 'Accept or reject changes one by one, export DOCX, and send for signature.',
    },
  },
  {
    icon: 'command',
    title: { ru: 'Быстрые команды', en: 'Quick commands' },
    body: {
      ru: 'Нажмите ⌘K для перехода куда угодно, или / в чате для команд /draft, /compare, /translate.',
      en: 'Press ⌘K to jump anywhere, or / in chat for /draft, /compare, /translate.',
    },
  },
];

function seen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

/** First-run product tour. Shows once, then never again (localStorage). */
export function OnboardingModal() {
  const { lang, t } = useI18n();
  const [open, setOpen] = useState(!seen());
  const [step, setStep] = useState(0);

  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <Modal
      open={open}
      title={`LexAI · ${step + 1}/${STEPS.length}`}
      onClose={finish}
      footer={
        <>
          <Button variant="ghost" onClick={finish}>
            {lang === 'ru' ? 'Пропустить' : 'Skip'}
          </Button>
          <Button variant="primary" onClick={() => (last ? finish() : setStep((s) => s + 1))}>
            {last ? (lang === 'ru' ? 'Начать' : 'Get started') : lang === 'ru' ? 'Далее' : 'Next'}
          </Button>
        </>
      }
    >
      <div style={{ textAlign: 'center', padding: '8px 4px 4px' }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            margin: '0 auto 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
            color: 'var(--accent)',
          }}
        >
          <Icon name={current.icon} size={26} />
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>{pickText(current.title, lang)}</h3>
        <p style={{ fontSize: 14, color: 'var(--dim)', lineHeight: 1.6, margin: 0 }}>{pickText(current.body, lang)}</p>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 22 }}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === step ? 20 : 7,
                height: 7,
                borderRadius: 999,
                background: i === step ? 'var(--accent)' : 'var(--border)',
                transition: 'width .2s',
              }}
            />
          ))}
        </div>
      </div>
      <span style={{ display: 'none' }}>{t('common.close')}</span>
    </Modal>
  );
}
