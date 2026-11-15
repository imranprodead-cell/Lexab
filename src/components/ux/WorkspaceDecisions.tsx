import { useUxT } from '@/i18n/uxMessages';
import { isFinalDecision, useFindingDecisions } from '@/lib/findingDecisions';
import { DecisionChip } from './DecisionBar';
import styles from './ux.module.css';

/**
 * Панель «Обзор» рядом с документом: те же решения по находкам, что и в чате
 * (общий кэш — отметка в чате сразу видна здесь и наоборот).
 */
export function WorkspaceDecisionProgress({ analysisId, findingIds }: { analysisId: string; findingIds: string[] }) {
  const u = useUxT();
  const { map } = useFindingDecisions(analysisId);
  const total = findingIds.length;
  if (!total) return null;
  const waiting = findingIds.filter((id) => !isFinalDecision(map[id])).length;
  return (
    <div className={styles.wsProgress}>
      <span>{waiting ? u('dec.progress', { n: waiting, total }) : u('dec.allDone', { total })}</span>
      <div className={`${styles.bar} ${waiting ? '' : styles.barDone}`}>
        <span style={{ width: `${Math.round(((total - waiting) / total) * 100)}%` }} />
      </div>
    </div>
  );
}

export function WorkspaceDecisionChip({ analysisId, findingId }: { analysisId: string; findingId: string }) {
  const { map } = useFindingDecisions(analysisId);
  return <DecisionChip decision={map[findingId]} />;
}
