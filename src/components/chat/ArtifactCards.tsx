import { Icon, type IconName } from '@/components/icons/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { useUxT } from '@/i18n/uxMessages';
import styles from './chat.module.css';

/**
 * Карточки того, что создал ИИ, внутри ответа: документ, большая таблица,
 * презентация. Как у Claude: серая плашка, цветной значок типа, название и тип
 * файла; вся карточка открывает его в боковой панели. Пока ИИ ещё пишет —
 * вместо типа «Создаётся…» (панель в это время показывает текст по ходу).
 */

type ArtKind = 'doc' | 'sheet' | 'slides';

const ICONS: Record<ArtKind, IconName> = { doc: 'doc', sheet: 'table', slides: 'presentation' };
const SUBS: Record<ArtKind, string> = { doc: 'art.doc', sheet: 'art.sheet', slides: 'art.slides' };

export function ArtifactCard({ kind, title, writing, onOpen }: { kind: ArtKind; title: string; writing?: boolean; onOpen: () => void }) {
  const u = useUxT();
  return (
    <button type="button" className={styles.artCard} data-kind={kind} onClick={onOpen} title={title}>
      <span className={styles.artIcon} data-kind={kind} aria-hidden="true">
        <Icon name={ICONS[kind]} size={20} strokeWidth={1.7} />
      </span>
      <span className={styles.artText}>
        <span className={styles.artTitle} dir="auto">
          {title}
        </span>
        <span className={styles.artSub}>
          {writing ? (
            <>
              <Spinner size={12} />
              {u('art.writing')}
            </>
          ) : (
            u(SUBS[kind])
          )}
        </span>
      </span>
    </button>
  );
}

export function DocArtifactCard({ title, writing, onOpen }: { title: string; writing?: boolean; onOpen: () => void }) {
  return <ArtifactCard kind="doc" title={title} writing={writing} onOpen={onOpen} />;
}

export function TableArtifactCard({ title, onOpen }: { title: string; onOpen: () => void }) {
  return <ArtifactCard kind="sheet" title={title} onOpen={onOpen} />;
}
