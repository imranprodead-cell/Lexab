/** Version-comparison API — AI diff of two uploaded contract versions. */
import type { Severity } from '@/types/domain';
import { USE_MOCK, httpForm } from './client';
import { delay } from './util';

export interface CompareChange {
  heading: string;
  kind: 'added' | 'removed' | 'modified';
  before: string;
  after: string;
  severity: Severity;
  comment: string;
}

export interface CompareResult {
  summary: string;
  changes: CompareChange[];
  fileA: string;
  fileB: string;
}

const MOCK_RESULT: CompareResult = {
  summary: 'Демо-сравнение: изменены три пункта, итоговый риск снизился.',
  fileA: 'Employment_v2.docx',
  fileB: 'Employment_v3.docx',
  changes: [
    {
      heading: '5. Termination',
      kind: 'modified',
      before: 'Either party may terminate this Agreement by giving one (1) week’s written notice to the other.',
      after: 'Either party may terminate this Agreement by giving one (1) month’s written notice to the other.',
      severity: 'High',
      comment: 'Срок уведомления приведён к статутному минимуму.',
    },
    {
      heading: '8. Post-Termination Restrictions',
      kind: 'modified',
      before: 'The Employee shall not, for a period of twelve (12) months following the Termination Date, solicit any client.',
      after: 'The Employee shall not, for a period of six (6) months following the Termination Date, solicit any client.',
      severity: 'Medium',
      comment: 'Более узкое ограничение легче защитить в суде.',
    },
    {
      heading: '11. Holiday Entitlement',
      kind: 'modified',
      before: 'The Employee is entitled to the statutory minimum in each holiday year.',
      after: 'The Employee is entitled to 28 days’ paid annual leave (inclusive of public holidays) in each holiday year.',
      severity: 'Medium',
      comment: 'Конкретная формулировка устраняет неопределённость.',
    },
  ],
};

export const compareApi = {
  async run(fileA: File, fileB: File): Promise<CompareResult> {
    if (USE_MOCK) {
      await delay(1200);
      return { ...MOCK_RESULT, fileA: fileA.name, fileB: fileB.name };
    }
    const form = new FormData();
    form.append('fileA', fileA);
    form.append('fileB', fileB);
    return httpForm<CompareResult>('/compare', form);
  },
};
