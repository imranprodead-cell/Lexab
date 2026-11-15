import type { Finding, Severity } from '@/types/domain';

/**
 * Темы колонок «Таблицы проверок» массового разбора.
 *
 * Тему ставит сам разбор (finding.topic, с 2026-11-15). Для старых разборов,
 * где её нет, тема угадывается по заголовку и ссылке (ru/en/uz).
 */
export const TOPICS = ['penalty', 'termination', 'disputes', 'payment', 'acceptance', 'other'] as const;
export type Topic = (typeof TOPICS)[number];

// Порядок важен: находка попадает в первую подходящую тему («расторжение по
// решению суда» — расторжение, «суд может уменьшить неустойку» — неустойка).
// JS \b не видит кириллицу, поэтому границы слов — через (?![а-яё]).
const RULES: { topic: Exclude<Topic, 'other'>; re: RegExp }[] = [
  { topic: 'termination', re: /расторж|односторонн|отказ[а-яё]* от (исполнения|договора)|прекращени[ея] договора|terminat|unilateral|bekor qil/i },
  { topic: 'penalty', re: /неустойк|пен[яиюе](?![а-яё])|штраф|ответственност|убытк|penalt|liabilit|damages|indemn|jarima|penya|javobgarlik|zarar/i },
  { topic: 'payment', re: /оплат|платеж|платёж|расч[её]т|предоплат|аванс|отсрочк|payment|invoice|prepay|to['ʻ’]?lov|hisob-kitob/i },
  { topic: 'acceptance', re: /при[её]мк|качеств|гаранти|недостат|некомплект|accept|quality|warrant|defect|qabul|sifat|kafolat/i },
  { topic: 'disputes', re: /подсудн|спор|арбитраж|третейск|суд|jurisdiction|dispute|arbitrat|court|nizo|sud(?![a-z])/i },
];

/** Тему ставит разбор (finding.topic); у старых разборов её нет — угадываем по словам. */
export function topicOf(f: Pick<Finding, 'title' | 'citation'> & { topic?: Finding['topic'] }): Topic {
  if (f.topic && (TOPICS as readonly string[]).includes(f.topic)) return f.topic;
  const text = `${f.title} ${f.citation ?? ''}`;
  for (const r of RULES) if (r.re.test(text)) return r.topic;
  return 'other';
}

export function groupByTopic<F extends Pick<Finding, 'title' | 'citation'> & { topic?: Finding['topic'] }>(findings: F[]): Record<Topic, F[]> {
  const out = Object.fromEntries(TOPICS.map((t) => [t, [] as F[]])) as Record<Topic, F[]>;
  for (const f of findings) out[topicOf(f)].push(f);
  return out;
}

const RANK: Record<Severity, number> = { High: 3, Medium: 2, Low: 1 };

/** Самая серьёзная находка клетки; неподтверждённые ссылки — «проверить». */
export function worstOf(findings: Pick<Finding, 'severity' | 'unverified'>[]): Severity | 'check' | null {
  if (!findings.length) return null;
  const verified = findings.filter((f) => !f.unverified);
  if (!verified.length) return 'check';
  return verified.reduce<Severity>((w, f) => (RANK[f.severity] > RANK[w] ? f.severity : w), 'Low');
}
