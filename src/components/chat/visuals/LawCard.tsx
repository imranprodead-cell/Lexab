import { Icon } from '@/components/icons/Icon';
import { LawQuote } from '@/components/ux/LawQuote';
import { useUxT } from '@/i18n/uxMessages';
import type { LawVisual } from '@/lib/visuals';
import styles from './visuals.module.css';

/**
 * Норма закона: официальный текст ТОЛЬКО из базы (LawQuote берёт его по id
 * через lawApi.unit), отметка «проверено», ссылка на источник. ИИ даёт лишь id
 * нормы и одну фразу — зачем она здесь; текст закона модель не пишет.
 */
export function LawCard({ data }: { data: LawVisual }) {
  const u = useUxT();
  return (
    <section className={styles.card} aria-label={data.label}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name="doc" size={16} />
        </span>
        <h4 className={styles.title} dir="auto">
          {data.label}
        </h4>
        <span className={styles.kicker}>{u('vis.law')}</span>
      </div>
      {data.note ? (
        <p className={styles.lawNote} dir="auto">
          {data.note}
        </p>
      ) : null}
      <LawQuote unitId={data.unitId} />
    </section>
  );
}
