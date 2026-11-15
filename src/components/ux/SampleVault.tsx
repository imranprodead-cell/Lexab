import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/I18nProvider';
import { useUxT } from '@/i18n/uxMessages';
import styles from './ux.module.css';

/*
 * Образцы для пустых «Плейбуков» и «Документов» (ui-test 2026-11-15). Позиции
 * в плейбуке — образец переговорной позиции команды, НЕ текст закона.
 */
const SAMPLE_PLAYBOOKS: { name: string; rules: string[] }[] = [
  {
    name: 'Поставка: позиция поставщика',
    rules: [
      'Пеня за просрочку не выше 0,5% в день и не больше 50% стоимости партии',
      'Оплата не позже 30 дней после поставки',
      'Споры рассматривает суд по месту нахождения ответчика',
      'Право одностороннего отказа есть у обеих сторон',
    ],
  },
  {
    name: 'NDA: взаимное',
    rules: [
      'Срок конфиденциальности не больше 3 лет после окончания договора',
      'Обязательства одинаковы для обеих сторон',
      'Исключения: общедоступные сведения и запросы госорганов',
    ],
  },
];

export function SamplePlaybooks({ locked, onCreate }: { locked: boolean; onCreate: () => void }) {
  const u = useUxT();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [trying, setTrying] = useState(false);
  return (
    <div className={styles.sampleZone}>
      {trying ? (
        <div className={styles.banner}>
          <Icon name="eye" size={15} />
          <span>{u('sm.banner')}</span>
          <Button variant="primary" size="sm" onClick={locked ? () => navigate('/plans') : onCreate}>
            {locked ? u('sm.toPro') : t('playbooks.new')}
          </Button>
          <button type="button" className={styles.link} onClick={() => setTrying(false)}>
            {u('sm.hide')}
          </button>
        </div>
      ) : null}
      <div className={`${styles.sampleGrid} ${trying ? '' : styles.faded}`} aria-hidden={!trying}>
        {SAMPLE_PLAYBOOKS.map((pb) => (
          <div key={pb.name} className={styles.sampleCard}>
            <div className={styles.sampleCardIcon}>
              <Icon name="shield" size={18} />
            </div>
            <div className={styles.sampleCardTitle}>{pb.name}</div>
            <ul className={styles.sampleRules}>
              {pb.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className={styles.sampleCardFoot}>
              <span>Узбекистан</span>
              <span className={styles.row} style={{ gap: 8 }}>
                <span className={`${styles.chip} ${styles.chipLow}`}>{u('sm.pbActive')}</span>
                {u('sm.pbRules', { n: pb.rules.length })}
              </span>
            </div>
          </div>
        ))}
      </div>
      {!trying ? (
        <div className={styles.cta}>
          <div className={styles.ctaKicker}>{locked ? u('sm.free') : u('sm.badge')}</div>
          <div className={styles.ctaTitle}>{u(locked ? 'sm.pbLocked' : 'sm.pbTitle')}</div>
          <p className={styles.ctaBody}>{u(locked ? 'sm.pbLockedBody' : 'sm.pbBody')}</p>
          <div className={styles.ctaBtns}>
            {locked ? (
              <>
                <Button variant="primary" onClick={() => setTrying(true)}>
                  {u('sm.view')}
                </Button>
                <Button variant="secondary" onClick={() => navigate('/plans')}>
                  {u('sm.plans')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" icon="plus" onClick={onCreate}>
                  {t('playbooks.new')}
                </Button>
                <Button variant="secondary" onClick={() => setTrying(true)}>
                  {u('sm.view')}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const SAMPLE_DOCS: { name: string; party: string; risk: 'High' | 'Elevated' | 'Low' }[] = [
  { name: 'Договор поставки № 14-2026.docx', party: 'ООО «Чорсу Текстиль»', risk: 'High' },
  { name: 'Аренда офиса 2026.pdf', party: 'ООО «Навбахор Офис»', risk: 'Elevated' },
  { name: 'NDA взаимное.docx', party: 'ООО «Зарафшан Дата»', risk: 'Low' },
];
const RISK_CHIP = { High: styles.chipHigh, Elevated: styles.chipMed, Low: styles.chipLow } as const;

/** Пустые «Документы»: как будут выглядеть карточки договоров + загрузка. */
export function SampleDocuments() {
  const u = useUxT();
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <div className={styles.sampleZone}>
      <div className={`${styles.sampleGrid} ${styles.faded}`} aria-hidden>
        {SAMPLE_DOCS.map((d) => (
          <div key={d.name} className={styles.sampleCard}>
            <div className={styles.sampleCardIcon}>
              <Icon name="docs" size={18} />
            </div>
            <div className={styles.sampleCardTitle}>{d.name}</div>
            <div className={`${styles.muted} ${styles.small}`}>{d.party}</div>
            <div className={styles.sampleCardFoot}>
              <span className={`${styles.chip} ${RISK_CHIP[d.risk]}`}>{t(`risk.${d.risk}`)}</span>
              <span>{u('sm.today')}</span>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.cta}>
        <div className={styles.ctaKicker}>{u('sm.badge')}</div>
        <div className={styles.ctaTitle}>{u('sm.docsTitle')}</div>
        <p className={styles.ctaBody}>{u('sm.docsBody')}</p>
        <div className={styles.ctaBtns}>
          <Button variant="primary" icon="upload" onClick={() => navigate('/chat')}>
            {u('sm.upload')}
          </Button>
        </div>
      </div>
    </div>
  );
}
