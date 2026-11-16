import { useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { localeFor } from '@/i18n/dates';
import { useI18n } from '@/i18n/I18nProvider';
import { useUxT } from '@/i18n/uxMessages';
import { niceTicks, visualAsText, type ChartVisual } from '@/lib/visuals';
import { CopyButton } from './CopyButton';
import { useElementWidth } from './visualUtils';
import styles from './visuals.module.css';

const H = 230;
const SERIES = ['var(--vis-s1)', 'var(--vis-s2)', 'var(--vis-s3)'];

/**
 * График в ответе: столбцы (один ряд) или линии (до трёх). Своя отрисовка в
 * SVG — без библиотеки (вес сайта): одна ось, ноль на оси, тонкие линии,
 * скругление 4px у столбцов, подсказка при наведении, легенда и подписи на
 * концах линий при нескольких рядах, вид «Таблица» — те же числа текстом.
 * Числа проверил сервер: только из калькулятора, вопроса или документов.
 */
export function ChartCard({ data }: { data: ChartVisual }) {
  const u = useUxT();
  const { lang } = useI18n();
  const locale = localeFor(lang);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [hot, setHot] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(boxRef);

  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const cf = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const unit = data.unit ? ` ${data.unit}` : '';
  const multi = data.series.length > 1;
  const isLine = data.kind === 'line';

  const M = { top: 12, right: isLine && multi ? 84 : 14, bottom: 30, left: 54 };
  const plotW = Math.max(40, width - M.left - M.right);
  const plotH = H - M.top - M.bottom;
  const all = data.series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(...all), Math.max(...all), 4);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const n = data.labels.length;
  const band = plotW / n;
  const x = (i: number) => M.left + band * (i + 0.5);
  const every = Math.max(1, Math.ceil(46 / band));
  const maxChars = Math.max(4, Math.floor((band * every) / 6.6));
  const short = (s: string) => (s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s);
  const y0 = y(0);

  // Подписи на концах линий: не налезают друг на друга (≥ 13px по вертикали).
  const ends = isLine && multi
    ? data.series
        .map((s, i) => ({ i, name: s.name || `#${i + 1}`, y: y(s.values[n - 1]) }))
        .sort((a, b) => a.y - b.y)
        .map((e, k, arr) => {
          if (k > 0 && e.y - arr[k - 1].y < 13) e.y = arr[k - 1].y + 13;
          return e;
        })
    : [];

  const bars = !isLine
    ? data.series[0].values.map((v, i) => {
        const bw = Math.min(40, band * 0.62);
        const x0 = x(i) - bw / 2;
        const top = Math.min(y(v), y0);
        const bottom = Math.max(y(v), y0);
        const h = Math.max(bottom - top, v === 0 ? 0 : 1.5);
        const r = Math.min(4, bw / 2, h);
        // Скругляется конец столбца — дальний от нуля.
        const d =
          v >= 0
            ? `M${x0},${bottom} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${bottom} Z`
            : `M${x0},${top} V${top + h - r} Q${x0},${top + h} ${x0 + r},${top + h} H${x0 + bw - r} Q${x0 + bw},${top + h} ${x0 + bw},${top + h - r} V${top} Z`;
        return { d, i };
      })
    : [];

  const tipX = hot === null ? 0 : x(hot);
  const tipY = hot === null ? 0 : Math.min(...data.series.map((s) => y(s.values[hot])), y0);
  const tipShift = tipX < 70 ? '0%' : tipX > width - 70 ? '-100%' : '-50%';

  return (
    <section className={styles.card} aria-label={data.title}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name="analytics" size={16} />
        </span>
        <h4 className={styles.title} dir="auto">
          {data.title}
        </h4>
        <div className={styles.actions}>
          <div className={styles.seg} role="group" aria-label={data.title}>
            <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
              {u('vis.chart')}
            </button>
            <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
              {u('vis.table')}
            </button>
          </div>
          <CopyButton text={() => visualAsText({ kind: 'chart', data }, (v) => nf.format(v))} />
        </div>
      </div>

      {/* Обёртка с замером ширины — на месте в обоих видах. */}
      <div className={styles.chartBox} ref={boxRef} onMouseLeave={() => setHot(null)}>
      {view === 'table' ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th />
              {data.series.map((s, i) => (
                <th key={i} className={styles.numCell}>
                  {s.name || data.unit || ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.labels.map((l, i) => (
              <tr key={i}>
                <td dir="auto">{l}</td>
                {data.series.map((s, j) => (
                  <td key={j} className={styles.numCell}>
                    {nf.format(s.values[i])}
                    {unit}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          {multi ? (
            <div className={styles.legend}>
              {data.series.map((s, i) => (
                <span key={i} className={styles.legendItem}>
                  <span className={styles.swatch} style={{ background: SERIES[i] }} />
                  <span dir="auto">{s.name || `#${i + 1}`}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div className={styles.chartArea}>
            <svg width={width} height={H} role="img" aria-label={data.title}>
              {ticks.map((tv) => (
                <g key={tv}>
                  <line x1={M.left} x2={M.left + plotW} y1={y(tv)} y2={y(tv)} className={tv === 0 ? styles.baseLine : styles.gridLine} />
                  <text x={M.left - 8} y={y(tv)} dy="0.32em" textAnchor="end" className={styles.tick}>
                    {cf.format(tv)}
                  </text>
                </g>
              ))}
              {data.labels.map((l, i) =>
                i % every === 0 ? (
                  <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className={styles.tick}>
                    {short(l)}
                  </text>
                ) : null,
              )}

              {bars.map((b) => (
                <path key={b.i} d={b.d} className={b.i === hot ? styles.barHot : styles.bar} />
              ))}

              {isLine
                ? data.series.map((s, si) => (
                    <path
                      key={si}
                      d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')}
                      fill="none"
                      stroke={SERIES[si]}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))
                : null}
              {isLine && hot !== null ? (
                <>
                  <line x1={x(hot)} x2={x(hot)} y1={M.top} y2={M.top + plotH} className={styles.cross} />
                  {data.series.map((s, si) => (
                    <circle key={si} cx={x(hot)} cy={y(s.values[hot])} r={4.5} fill={SERIES[si]} className={styles.dot} />
                  ))}
                </>
              ) : null}
              {/* Подпись конца линии — цветом текста; цвет ряда — у чёрточки рядом. */}
              {ends.map((e) => (
                <g key={e.i}>
                  <line x1={M.left + plotW + 6} x2={M.left + plotW + 16} y1={e.y} y2={e.y} stroke={SERIES[e.i]} strokeWidth={3} strokeLinecap="round" />
                  <text x={M.left + plotW + 21} y={e.y} dy="0.32em" className={styles.tick}>
                    {e.name.length > 9 ? `${e.name.slice(0, 8)}…` : e.name}
                  </text>
                </g>
              ))}

              {/* Зоны наведения шире самих меток: вся полоса по высоте графика. */}
              {data.labels.map((l, i) => (
                <rect
                  key={i}
                  x={M.left + band * i}
                  y={M.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${l}: ${data.series.map((s) => `${s.name ? `${s.name} ` : ''}${nf.format(s.values[i])}${unit}`).join(', ')}`}
                  onMouseEnter={() => setHot(i)}
                  onFocus={() => setHot(i)}
                  onBlur={() => setHot(null)}
                />
              ))}
            </svg>
            {hot !== null ? (
              <div className={styles.tip} style={{ left: tipX, top: tipY, transform: `translate(${tipShift}, calc(-100% - 8px))` }}>
                <div dir="auto">{data.labels[hot]}</div>
                {data.series.map((s, si) => (
                  <div key={si} className={styles.tipRow}>
                    {multi ? <span className={styles.swatch} style={{ background: SERIES[si] }} /> : null}
                    {s.name && multi ? <span dir="auto">{s.name}</span> : null}
                    <b>
                      {nf.format(s.values[hot])}
                      {unit}
                    </b>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </>
      )}
      </div>
    </section>
  );
}
