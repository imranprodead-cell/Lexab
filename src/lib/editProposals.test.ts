import { describe, expect, it } from 'vitest';
import { extractActions, extractEdits, stripEditBlocks } from './editProposals';
import { displayText, extractQuestions } from './questions';
import { isDocBlock } from './artifacts';

const block = (p: object) => '```lexab-edit\n' + JSON.stringify(p).replace(/`/g, '\\u0060') + '\n```';

describe('edit proposal cards', () => {
  it('cuts the service blocks out of the reply and parses them', () => {
    const p = { analysisId: 'an_1', delText: 'п. 5. Пеня 1%.', insText: 'п. 5. Пеня 0,1%.', reason: 'выше законной' };
    const text = `Предлагаю смягчить пеню.\n\n${block(p)}`;
    const { body, edits } = extractEdits(text);
    expect(body).toBe('Предлагаю смягчить пеню.');
    expect(edits).toEqual([p]);
  });

  it('survives backticks inside the clause and ignores broken blocks', () => {
    const p = { analysisId: 'an_1', delText: 'код ```x``` тут', insText: '', reason: '' };
    const { edits } = extractEdits(`Ок.\n\n${block(p)}\n\n\`\`\`lexab-edit\n{не json\n\`\`\``);
    expect(edits).toEqual([p]);
    expect(stripEditBlocks(`Ок.\n\n${block(p)}`)).toBe('Ок.');
  });

  it('never shows the service block in the text, copy or side-panel documents', () => {
    const text = `Ответ.\n\n${block({ analysisId: 'a', delText: 'x', insText: 'y', reason: '' })}`;
    expect(extractQuestions(text).body).toBe('Ответ.');
    expect(displayText(text)).toBe('Ответ.');
    expect(isDocBlock('a\nb\nc\nd\ne\nf\ng', 'lexab-edit')).toBe(false);
  });

  it('leaves ordinary replies untouched', () => {
    const plain = 'Обычный ответ\n\n```\nкод\n```';
    expect(extractEdits(plain)).toEqual({ body: plain, edits: [] });
  });

  it('reads deadline cards and hides them from the text', () => {
    const r = { documentId: 'd1', documentName: 'Поставка.docx', text: 'Оплатить поставку', dueDate: '2026-11-20', remindDaysBefore: 3 };
    const e = { analysisId: 'a', delText: 'x', insText: 'y', reason: '' };
    const text = `Поставил срок.\n\n${block(e)}\n\n\`\`\`lexab-reminder\n${JSON.stringify(r)}\n\`\`\``;
    const { body, edits, reminders } = extractActions(text);
    expect(body).toBe('Поставил срок.');
    expect(edits).toEqual([e]);
    expect(reminders).toEqual([r]);
    expect(displayText(text)).toBe('Поставил срок.');
    const broken = extractActions('Ок.\n\n```lexab-reminder\n{"documentId":"d","text":"t","dueDate":"20.11.2026"}\n```');
    expect(broken.reminders).toEqual([]);
    expect(broken.body).toBe('Ок.');
  });
});
