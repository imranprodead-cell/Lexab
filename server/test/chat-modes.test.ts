import assert from 'node:assert/strict';
import test from 'node:test';
import { modeMaxTokens, parseChatMode } from '../src/lib/chatModes.ts';
import { fallbackChatReply } from '../src/fallback.ts';

test('parseChatMode: /plan и /slides распознаются только как команда в начале', () => {
  assert.deepEqual(parseChatMode('/plan Арендатор не платит'), { mode: 'plan', body: 'Арендатор не платит' });
  assert.deepEqual(parseChatMode('  /SLIDES   для совета директоров '), { mode: 'slides', body: 'для совета директоров' });
  assert.deepEqual(parseChatMode('/slides'), { mode: 'slides', body: '' });
  assert.deepEqual(parseChatMode('/approve План одобрен.'), { mode: 'approve', body: 'План одобрен.' });
  // Не команда: слово без слеша, слеш в середине, похожее слово.
  assert.equal(parseChatMode('plan the case').mode, null);
  assert.equal(parseChatMode('см. /plan ниже').mode, null);
  assert.equal(parseChatMode('/planning').mode, null);
  assert.equal(parseChatMode('/slidesx').mode, null);
  assert.equal(parseChatMode('/approved').mode, null);
  assert.equal(parseChatMode('/draft NDA').mode, null);
  assert.equal(parseChatMode('обычный вопрос').body, 'обычный вопрос');
});

test('modeMaxTokens: плану и колоде — больший потолок, обычному чату — прежний', () => {
  assert.equal(modeMaxTokens('slides'), 8000);
  assert.equal(modeMaxTokens('plan'), 8000);
  assert.equal(modeMaxTokens('approve'), 8000);
  assert.equal(modeMaxTokens(null), 4096);
});

test('fallback без ИИ: /slides отвечает колодой в формате «# заголовок / ## слайд»', () => {
  const deck = fallbackChatReply('/slides');
  const lines = deck.split('\n');
  assert.ok(lines[0].startsWith('# '), 'первая строка — заголовок колоды');
  assert.ok(lines.filter((l) => l.startsWith('## ')).length >= 2, 'минимум два слайда');
  assert.match(fallbackChatReply('/plan долг'), /###/);
});
