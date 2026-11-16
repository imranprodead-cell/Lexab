import { useMemo } from 'react';
import { parseVisual } from '@/lib/visuals';
import { ChartCard } from './ChartCard';
import { LawCard } from './LawCard';
import { StepsCard } from './StepsCard';
import { TimelineCard } from './TimelineCard';

/** Блок ```lexab-steps|timeline|law|chart``` из ответа ИИ → карточка; битый — ничего. */
export function VisualBlock({ lang, raw }: { lang: string; raw: string }) {
  const v = useMemo(() => parseVisual(lang, raw), [lang, raw]);
  if (!v) return null;
  switch (v.kind) {
    case 'steps':
      return <StepsCard data={v.data} />;
    case 'timeline':
      return <TimelineCard data={v.data} />;
    case 'law':
      return <LawCard data={v.data} />;
    case 'chart':
      return <ChartCard data={v.data} />;
  }
}
