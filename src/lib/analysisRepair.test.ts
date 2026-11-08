import { describe, expect, it } from 'vitest';
import { mergeRepaired } from './analysisRepair';
import type { AnalysisResult } from '@/types/domain';

const base = (over: Partial<AnalysisResult> = {}): AnalysisResult =>
  ({
    id: 'an_1',
    fileName: 'Поставка.docx',
    fileSize: '9 KB',
    summary: 'Разбор',
    riskScore: 70,
    riskLevel: 'High',
    clausesReviewed: 5,
    findings: [
      { id: 'f1', severity: 'High', title: 'Пеня без потолка', citation: 'ст. 32', unitId: 'u32', redlineId: 'r1' },
      { id: 'f2', severity: 'Low', title: 'Качество', citation: 'ст. 999 ГК', unitId: null, redlineId: 'r2', unverified: true },
    ],
    redlines: [
      { id: 'r1', delText: 'a', insText: 'b', severity: 'High', status: 'accepted' },
      { id: 'r2', delText: 'c', insText: 'd', severity: 'Low', status: 'pending' },
    ],
    document: [{ type: 'paragraph', segments: ['изменённый пользователем текст'] }],
    repairPending: true,
    ...over,
  }) as AnalysisResult;

describe('mergeRepaired — background citation repair', () => {
  it('takes the fixed findings and redline severity, keeps the user\'s document and redline statuses', () => {
    const fresh = base({
      findings: [
        base().findings[0],
        { id: 'f2', severity: 'Medium', title: 'Качество', citation: 'ст. 26 Закона № 670-I', unitId: 'u26', redlineId: 'r2', unverified: false },
      ],
      redlines: [
        { id: 'r1', delText: 'a', insText: 'b', severity: 'High', status: 'pending' },
        { id: 'r2', delText: 'c', insText: 'd', severity: 'Medium', status: 'pending' },
      ],
      document: [{ type: 'paragraph', segments: ['старый текст с сервера'] }],
      repairPending: undefined,
    });
    const merged = mergeRepaired(base(), fresh);
    expect(merged.findings[1]).toMatchObject({ citation: 'ст. 26 Закона № 670-I', unverified: false, severity: 'Medium' });
    expect(merged.redlines.map((r) => [r.status, r.severity])).toEqual([['accepted', 'High'], ['pending', 'Medium']]);
    expect(merged.document).toEqual(base().document);
    expect(merged.repairPending).toBeUndefined();
  });

  it('ignores a different analysis and keeps waiting while the server still repairs', () => {
    const local = base();
    expect(mergeRepaired(local, base({ id: 'an_2' }))).toBe(local);
    expect(mergeRepaired(local, base()).repairPending).toBe(true);
  });
});
