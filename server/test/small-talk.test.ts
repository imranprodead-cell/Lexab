/* Приветствия и короткие реплики не запускают поиск по базе законов
   (lib/smallTalk.ts). Любое сомнение — поиск, поэтому проверяем и обратное. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAboutAssistant, isSmallTalk, skipsLawSearch } from '../src/lib/smallTalk.ts';

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

test('questions about the assistant itself skip the law search (RU/UZ/EN)', () => {
  for (const t of [
    'расскажи о своих возможностях',
    'Расскажи о своих возможностях',
    'Привет! Расскажи о своих возможностях',
    'Что ты умеешь?',
    'что ты умеешь делать',
    'Кто ты?',
    'Чем можешь помочь?',
    'Чем вы можете помочь?',
    'Какие у тебя функции?',
    'Расскажи о себе',
    'Как тобой пользоваться?',
    'Nima qila olasan?',
    'Oʻzing haqida gapirib ber',
    'Imkoniyatlaringiz haqida aytib bering',
    'Sen kimsan?',
    'Нима қила оласиз?',
    'What can you do?',
    'Tell me about yourself',
    'Hi! Who are you?',
    'How can you help me?',
  ]) {
    assert.equal(skipsLawSearch(t), true, t);
    assert.equal(isSmallTalk(t) || isAboutAssistant(t), true, t);
  }
});

test('legal questions that share words with them still search', () => {
  for (const t of [
    'Что ты можешь сказать о договоре аренды?',
    'Какие функции у нотариуса?',
    'Кто несёт ответственность за просрочку?',
    'Что я могу сделать?',
    'What can I do?',
    'Можешь проверить пункт 5?',
    'Помоги составить претензию',
    'Расскажи о своих возможностях по проверке договора поставки',
    'Nima qilish kerak?',
    'что делать',
    'Привет, помоги с договором',
  ]) {
    assert.equal(skipsLawSearch(t), false, t);
  }
});
