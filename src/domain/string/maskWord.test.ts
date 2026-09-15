// src/domain/string/maskWord.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskWordInSentence } from './maskWord.js';
import { stem } from './porterStemmer.js';

// ============================================================
// stem：Porter Stemmer 演算法
// ============================================================

test('stem: 原形不變', () => {
    assert.equal(stem('apple'), 'appl');
    assert.equal(stem('book'), 'book');
    assert.equal(stem('cat'), 'cat');
});

test('stem: 複數 -s / -es', () => {
    assert.equal(stem('apples'), 'appl');
    assert.equal(stem('boxes'), 'box');
    assert.equal(stem('cities'), 'citi');
});

test('stem: 動詞 -ed', () => {
    assert.equal(stem('recited'), 'recit');
    assert.equal(stem('walked'), 'walk');
    assert.equal(stem('studied'), 'studi');
});

test('stem: 動詞 -ing（含重複子音）', () => {
    assert.equal(stem('reciting'), 'recit');
    assert.equal(stem('running'), 'run');
    assert.equal(stem('walking'), 'walk');
});

test('stem: 原形與屈折形式詞幹一致（核心保證）', () => {
    assert.equal(stem('recite'), stem('recited'));
    assert.equal(stem('recite'), stem('recites'));
    assert.equal(stem('recite'), stem('reciting'));
    assert.equal(stem('apple'), stem('apples'));
    assert.equal(stem('run'), stem('running'));
});

test('stem: 不做派生（避免 over-stemming）', () => {
    // "artist" 是 "art" 的派生詞，兩者不應該被 stem 成一樣
    assert.notEqual(stem('art'), stem('artist'));
    // ⚠️ 注意：nation / nationality 會 stem 成一樣（Porter 正確行為）
    //          -ality → -al → 去掉 -al 後回到 nation
    //          這對遮罩來說是「好事」：學生看到 nationality 確實能猜到 nation
    // assert.notEqual(stem('nation'), stem('nationality'));  // ❌ 這行是錯的
});

test('stem: 短詞（< 3 字元）不做處理', () => {
    assert.equal(stem('a'), 'a');
    assert.equal(stem('an'), 'an');
    assert.equal(stem('is'), 'is');
});

// ============================================================
// maskWordInSentence：遮罩邏輯
// ============================================================

test('基本匹配：單字本身', () => {
    assert.equal(
        maskWordInSentence('I eat an apple every day.', 'apple'),
        'I eat an _____ every day.'
    );
});

test('複數形式：apple / apples', () => {
    assert.equal(
        maskWordInSentence('I like apples.', 'apple'),
        'I like ______.'
    );
});

test('動詞 -ed：recite / recited', () => {
    assert.equal(
        maskWordInSentence('The child recited a poem.', 'recite'),
        'The child _______ a poem.'
    );
});

test('動詞 -ing：recite / reciting', () => {
    assert.equal(
        maskWordInSentence('She is reciting a poem.', 'recite'),
        'She is ________ a poem.'
    );
});

test('動詞 -s：recite / recites', () => {
    assert.equal(
        maskWordInSentence('She recites beautifully.', 'recite'),
        'She _______ beautifully.'
    );
});

test('大小寫不敏感', () => {
    assert.equal(
        maskWordInSentence('An APPLE a day keeps the doctor away.', 'apple'),
        'An _____ a day keeps the doctor away.'
    );
    assert.equal(
        maskWordInSentence('I eat an Apple.', 'apple'),
        'I eat an _____.'
    );
});

test('句中多次出現 → 全部遮罩', () => {
    assert.equal(
        maskWordInSentence('I eat an apple. An apple is good.', 'apple'),
        'I eat an _____. An _____ is good.'
    );
});

test('不匹配 → 不遮罩', () => {
    assert.equal(
        maskWordInSentence('The cat sleeps.', 'apple'),
        'The cat sleeps.'
    );
});

test('派生詞不誤判：art / artist', () => {
    // 學生寫 "art"，例句中的 "artist" 不應該被遮罩
    assert.equal(
        maskWordInSentence('The artist paints.', 'art'),
        'The artist paints.'
    );
});

test('空字串 → 回傳原文', () => {
    assert.equal(maskWordInSentence('', 'apple'), '');
    assert.equal(maskWordInSentence('I eat an apple.', ''), 'I eat an apple.');
    assert.equal(maskWordInSentence('', ''), '');
});

test('標點符號與空白保留', () => {
    assert.equal(
        maskWordInSentence('Hello, world! An apple, please.', 'apple'),
        'Hello, world! An _____, please.'
    );
});

test('數字與符號不影響匹配', () => {
    assert.equal(
        maskWordInSentence('There are 3 apples.', 'apple'),
        'There are 3 ______.'
    );
});

test('句首的單字也能匹配', () => {
    assert.equal(
        maskWordInSentence('Apples are red.', 'apple'),
        '______ are red.'
    );
});

test('stem: 處理重複子音（簡單正則做不到）', () => {
  // "running" → "run"（去掉 -ing 後，需去掉重複的 n）
  assert.equal(stem('running'), 'run');
  assert.equal(stem('stopping'), 'stop');
  assert.equal(stem('beginning'), 'begin');

  // 對比：簡單地去掉 -ing 會得到 "runn" / "stopp" / "beginn"，都是錯的
});

test('stem: 處理 y → i 的變化', () => {
  assert.equal(stem('study'), 'studi');
  assert.equal(stem('studies'), 'studi');
  assert.equal(stem('studied'), 'studi');
});