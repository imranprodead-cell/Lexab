/* Приветствия и короткие реплики не запускают поиск по базе законов
   (lib/smallTalk.ts). Любое сомнение — поиск, поэтому проверяем и обратное. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSmallTalk } from '../src/lib/smallTalk.ts';

test('greetings, thanks and acks in RU/UZ/EN are small talk', () => {
  for (const t of ['Привет', 'привет, как дела?', 'Здравствуйте!', 'Добрый день', 'Спасибо!', 'Спасибо большое', 'Ок', 'Понятно, спасибо', 'Пока', 'Salom', 'Assalomu alaykum', 'Rahmat', 'Hi', 'Hello, how are you?', 'Thanks!', 'Всё ясно']) {
    assert.equal(isSmallTalk(t), true, t);
  }
});

test('anything with a question, a task or a number still searches the law', () => {
  for (const t of [
    'Привет, помоги с договором',
    'Спасибо, а что насчёт пени?',
    'Как расторгнуть договор?',
    'Какая неустойка по ст. 32?',
    'Hi, can you review my lease?',
    'Ok, 0.4% per day?',
    'Добрый день, у меня вопрос по аренде офиса на два года',
    '',
    '   ',
  ]) {
    assert.equal(isSmallTalk(t), false, t);
  }
});
