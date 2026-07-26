import { useState } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/I18nProvider';

const STORAGE_KEY = 'lexai.onboarded';

interface Step {
  icon: IconName;
  titleKey: string;
  bodyKey: string;
}

const STEPS: Step[] = [
  { icon: 'search', titleKey: 'onboard.step1Title', bodyKey: 'onboard.step1Body' },
  { icon: 'layout', titleKey: 'onboard.step2Title', bodyKey: 'onboard.step2Body' },
  { icon: 'command', titleKey: 'onboard.step3Title', bodyKey: 'onboard.step3Body' },
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
  const { t } = useI18n();
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
      title={`Lexab · ${step + 1}/${STEPS.length}`}
      onClose={finish}
      footer={
        <>
          <Button variant="ghost" onClick={finish}>
            {t('onboard.skip')}
          </Button>
          <Button variant="primary" onClick={() => (last ? finish() : setStep((s) => s + 1))}>
            {last ? t('onboard.start') : t('onboard.next')}
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
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>{t(current.titleKey)}</h3>
        <p style={{ fontSize: 14, color: 'var(--dim)', lineHeight: 1.6, margin: 0 }}>{t(current.bodyKey)}</p>
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
