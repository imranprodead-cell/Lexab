/**
 * Deterministic fallbacks used when no ANTHROPIC_API_KEY is configured (or an
 * LLM request fails). Output mirrors the canonical demo analysis in the
 * frontend seed, parameterised by file name so repeated runs feel plausible.
 */
import crypto from 'node:crypto';
import type { CompareResult, GeneratedAnalysis, TemplateFields } from './llm.ts';

function hashInt(input: string): number {
  return crypto.createHash('sha256').update(input).digest().readUInt32BE(0);
}

export function fallbackAnalysis(fileName: string): GeneratedAnalysis {
  const h = hashInt(fileName);
  const riskScore = 45 + (h % 31); // 45–75
  const riskLevel = riskScore < 34 ? 'Low' : riskScore < 67 ? 'Elevated' : 'High';
  const baseName = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');

  return {
    summary:
      `This contract (“${baseName}”) is largely standard, but three clauses create material legal exposure. ` +
      'The termination notice sits below the statutory floor, and the post-termination covenant is drafted too broadly to be reliably enforced. ' +
      'Tracked redlines are prepared for each finding.',
    riskScore,
    riskLevel,
    clausesReviewed: 12 + (h % 9),
    findings: [
      {
        severity: 'High',
        title: 'Termination notice below statutory minimum',
        citation: 'Employment Rights Act 1996, s.86',
      },
      {
        severity: 'Medium',
        title: 'Restraint of trade likely too broad to enforce',
        citation: 'Tillman v Egon Zehnder [2019] UKSC 32',
      },
      {
        severity: 'Medium',
        title: 'Holiday entitlement clause not compliant',
        citation: 'Working Time Regulations 1998, reg.13',
      },
    ],
    redlines: [
      { id: 'r1', delText: "one (1) week's", insText: "one (1) month's", severity: 'High' },
      { id: 'r2', delText: 'twelve (12) months', insText: 'six (6) months', severity: 'Medium' },
      {
        id: 'r3',
        delText: 'the statutory minimum',
        insText: "28 days' paid annual leave (inclusive of public holidays), accruing pro rata",
        severity: 'Medium',
      },
    ],
    document: [
      { type: 'heading', text: '5.  Termination' },
      {
        type: 'paragraph',
        segments: [
          'Either party may terminate this Agreement by giving ',
          { redlineId: 'r1' },
          ' written notice to the other. Upon termination, the Employee shall promptly return all Company property and confidential materials.',
        ],
      },
      { type: 'heading', text: '8.  Post-Termination Restrictions' },
      {
        type: 'paragraph',
        segments: [
          'The Employee shall not, for a period of ',
          { redlineId: 'r2' },
          ' following the Termination Date, solicit or entice away any client with whom the Employee dealt during the twelve (12) months prior to termination.',
        ],
      },
      { type: 'heading', text: '11.  Holiday Entitlement' },
      {
        type: 'paragraph',
        segments: [
          'The Employee is entitled to ',
          { redlineId: 'r3' },
          " in each holiday year, in addition to the Employee's normal working days.",
        ],
      },
    ],
  };
}

/** Canned chat replies mirroring the frontend's mock (useChatStore.mockReply). */
export function fallbackChatReply(text: string, hasDocument = false): string {
  const t = text.trim().toLowerCase();
  if (hasDocument && !t.startsWith('/')) {
    return 'Я вижу документ, но для содержательного ответа по его пунктам нужен подключённый ИИ (ANTHROPIC_API_KEY на сервере). Пока могу подсказать общую структуру: проверьте пункты о расторжении, ответственности и применимом праве — именно там чаще всего скрыты риски.';
  }
  if (t.startsWith('/draft')) {
    return 'Готовлю черновик. Вот структура двустороннего NDA (право Великобритании): 1) Стороны и определения; 2) Конфиденциальная информация; 3) Обязательства получателя; 4) Исключения; 5) Срок и возврат; 6) Средства правовой защиты; 7) Применимое право. Скажите, какие пункты уточнить.';
  }
  if (t.startsWith('/compare')) {
    return 'Сравнение версий: обнаружено 6 изменённых пунктов. Ключевые: срок уведомления о расторжении сокращён с 3 месяцев до 1; добавлена оговорка о неконкуренции (12 мес.); изменён порядок разрешения споров на арбитраж LCIA. Открыть детальный дифф?';
  }
  if (t.startsWith('/translate')) {
    return 'Готов перевести и локализовать текст. Укажите целевой язык и юрисдикцию — я адаптирую терминологию и ссылки на нормы под местное право.';
  }
  return 'Принял. Уточните детали контракта или пункта — и я подготовлю ответ со ссылками на применимые нормы. Для полного обзора рисков загрузите документ или используйте /analyze.';
}

/** Deterministic version-diff used when no LLM is configured. */
export function fallbackCompare(): CompareResult {
  return {
    summary:
      'Между версиями изменены три пункта: срок уведомления о расторжении увеличен, период неконкуренции сокращён, уточнён отпуск. Итоговый риск снизился. (Для полноценного сравнения подключите ANTHROPIC_API_KEY на сервере.)',
    changes: [
      {
        heading: '5. Termination',
        kind: 'modified',
        before: 'Either party may terminate this Agreement by giving one (1) week’s written notice to the other.',
        after: 'Either party may terminate this Agreement by giving one (1) month’s written notice to the other.',
        severity: 'High',
        comment: 'Срок уведомления приведён к статутному минимуму — риск устранён.',
      },
      {
        heading: '8. Post-Termination Restrictions',
        kind: 'modified',
        before: 'The Employee shall not, for a period of twelve (12) months following the Termination Date, solicit any client.',
        after: 'The Employee shall not, for a period of six (6) months following the Termination Date, solicit any client.',
        severity: 'Medium',
        comment: 'Более узкое ограничение с большей вероятностью будет признано исполнимым.',
      },
      {
        heading: '11. Holiday Entitlement',
        kind: 'modified',
        before: 'The Employee is entitled to the statutory minimum in each holiday year.',
        after: 'The Employee is entitled to 28 days’ paid annual leave (inclusive of public holidays) in each holiday year.',
        severity: 'Medium',
        comment: 'Формулировка конкретизирована — устраняет неопределённость.',
      },
    ],
  };
}

/** Skeleton contract used when no LLM is configured. */
export function fallbackTemplateDraft(templateName: string, f: TemplateFields): string {
  return `${templateName.toUpperCase()}

This ${templateName} ("Agreement") is entered into between:
(1) ${f.partyA || 'Party A'} ("Party A"); and
(2) ${f.partyB || 'Party B'} ("Party B").

1. PURPOSE
   The parties wish to set out the terms governing their relationship under this ${templateName}.

2. TERM
   This Agreement takes effect on the date of last signature and continues for ${f.term || 'twelve (12) months'} unless terminated earlier in accordance with clause 5.

3. OBLIGATIONS
   Each party shall perform its obligations diligently, in good faith and in accordance with applicable law.
   ${f.details ? 'Additional terms agreed by the parties: ' + f.details : ''}

4. CONFIDENTIALITY
   Each party shall keep confidential all non-public information received from the other and use it solely for the purposes of this Agreement.

5. TERMINATION
   Either party may terminate this Agreement on one (1) month’s written notice to the other.

6. GOVERNING LAW
   This Agreement is governed by the laws of ${f.jurisdiction || 'England and Wales'}, and the courts of that jurisdiction have exclusive jurisdiction.

SIGNED by the duly authorised representatives of the parties.

—
Черновик сгенерирован в демо-режиме. Подключите ANTHROPIC_API_KEY на сервере, чтобы получать полные договоры, составленные ИИ под ваши условия.`;
}
