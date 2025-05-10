import { describe, expect, it } from 'vitest';
import {
  CasingStyle,
  analyzeCasingFromHumanAnswers,
  analyzeCasingFromText,
  analyzeCasingStyle,
  isAllLowercase,
  isAllUppercase,
  isTitleCase,
  startsWithUppercase,
} from '../../src/utils/casingAnalyzer';

describe('Casing Detection Functions', () => {
  describe('startsWithUppercase', () => {
    it('returns true for strings starting with uppercase', () => {
      expect(startsWithUppercase('Hello world')).toBe(true);
      expect(startsWithUppercase('Testing this function')).toBe(true);
      expect(startsWithUppercase('A')).toBe(true);
    });

    it('returns false for strings starting with lowercase', () => {
      expect(startsWithUppercase('hello world')).toBe(false);
      expect(startsWithUppercase('testing this function')).toBe(false);
      expect(startsWithUppercase('a')).toBe(false);
    });

    it('returns false for strings starting with non-alphabetic characters', () => {
      expect(startsWithUppercase('123 test')).toBe(false);
      expect(startsWithUppercase(' Hello')).toBe(false);
      expect(startsWithUppercase('!Hello')).toBe(false);
    });

    it('handles empty strings correctly', () => {
      expect(startsWithUppercase('')).toBe(false);
    });
  });

  describe('isAllLowercase', () => {
    it('returns true for strings with all lowercase letters', () => {
      expect(isAllLowercase('hello world')).toBe(true);
      expect(isAllLowercase('testing this function')).toBe(true);
      expect(isAllLowercase('a')).toBe(true);
    });

    it('returns false for strings with any uppercase letters', () => {
      expect(isAllLowercase('Hello world')).toBe(false);
      expect(isAllLowercase('testing This function')).toBe(false);
      expect(isAllLowercase('testinG')).toBe(false);
    });

    it('handles special characters and numbers correctly', () => {
      expect(isAllLowercase('hello123')).toBe(true);
      expect(isAllLowercase('hello!')).toBe(true);
      expect(isAllLowercase('123test')).toBe(false); // Doesn't start with lowercase
    });

    it('handles empty strings correctly', () => {
      expect(isAllLowercase('')).toBe(false); // Doesn't start with lowercase
    });
  });

  describe('isAllUppercase', () => {
    it('returns true for strings with all uppercase letters', () => {
      expect(isAllUppercase('HELLO WORLD')).toBe(true);
      expect(isAllUppercase('TESTING THIS FUNCTION')).toBe(true);
      expect(isAllUppercase('A')).toBe(true);
    });

    it('returns false for strings with any lowercase letters', () => {
      expect(isAllUppercase('HELLO world')).toBe(false);
      expect(isAllUppercase('TESTING This FUNCTION')).toBe(false);
      expect(isAllUppercase('TESTINg')).toBe(false);
    });

    it('handles special characters and numbers correctly', () => {
      expect(isAllUppercase('HELLO123')).toBe(true);
      expect(isAllUppercase('HELLO!')).toBe(true);
      expect(isAllUppercase('123TEST')).toBe(true);
    });

    it('handles empty strings correctly', () => {
      expect(isAllUppercase('')).toBe(false); // Doesn't start with uppercase
    });
  });

  describe('isTitleCase', () => {
    it('returns true when more than 60% of words start with uppercase', () => {
      expect(isTitleCase('Hello World')).toBe(true);
      expect(isTitleCase('This Is A Title Case Sentence')).toBe(true);
      expect(isTitleCase('Most Words Are Capitalized Here')).toBe(true);
      expect(isTitleCase('Only one word not Capitalized In This Example')).toBe(true); // 5/6 capitalized
    });

    it('returns false when less than 60% of words start with uppercase', () => {
      expect(isTitleCase('hello world')).toBe(false);
      expect(isTitleCase('Only One Word is Capitalized')).toBe(false); // 3/6 capitalized
      expect(isTitleCase('this Is not title Case')).toBe(false);
    });

    it('handles edge cases correctly', () => {
      expect(isTitleCase('Single')).toBe(true);
      expect(isTitleCase('single')).toBe(false);
      expect(isTitleCase('')).toBe(false);
    });

    it('handles mixed case with numbers and special characters', () => {
      expect(isTitleCase('Hello 123 World!')).toBe(true);
      expect(isTitleCase('Testing With Special! Characters')).toBe(true);
    });
  });

  describe('analyzeCasingStyle', () => {
    it('detects lowercase style correctly', () => {
      const sentences = [
        'hello world',
        'this is all lowercase',
        'no capitals here',
        'one More with capital',
      ];
      expect(analyzeCasingStyle(sentences)).toBe(CasingStyle.LOWERCASE);
    });

    it('detects title case style correctly', () => {
      const sentences = [
        'This Is Title Case',
        'Every Word Is Capitalized',
        'More Title Case Here',
        'one not in title case',
      ];
      expect(analyzeCasingStyle(sentences)).toBe(CasingStyle.TITLE_CASE);
    });

    it('detects sentence case style correctly', () => {
      const sentences = [
        'This is sentence case',
        'Another example of sentence case',
        'Just the first word capitalized',
        'Final example here',
      ];
      expect(analyzeCasingStyle(sentences)).toBe(CasingStyle.SENTENCE_CASE);
    });

    it('detects uppercase style correctly', () => {
      const sentences = [
        'ALL UPPERCASE TEXT',
        'ANOTHER UPPERCASE SENTENCE',
        'EVERYTHING IS CAPS HERE',
        'one exception',
      ];
      expect(analyzeCasingStyle(sentences)).toBe(CasingStyle.UPPERCASE);
    });

    it('defaults to sentence case when there is no dominant style', () => {
      const sentences = [
        'This is sentence case',
        'this is lowercase',
        'This Is Title Case',
        'another lowercase one',
      ];
      expect(analyzeCasingStyle(sentences)).toBe(CasingStyle.SENTENCE_CASE);
    });

    it('handles empty arrays correctly', () => {
      expect(analyzeCasingStyle([])).toBe(CasingStyle.SENTENCE_CASE);
    });

    it('ignores empty sentences', () => {
      const sentences = ['This is a sentence', '', '  ', 'This is another sentence'];
      expect(analyzeCasingStyle(sentences)).toBe(CasingStyle.SENTENCE_CASE);
    });
  });

  describe('analyzeCasingFromText', () => {
    it('correctly analyzes lowercase text', () => {
      const text = 'hello there. this is all lowercase. no capitals anywhere. plain and simple.';
      expect(analyzeCasingFromText(text)).toBe(CasingStyle.LOWERCASE);
    });

    it('correctly analyzes title case text', () => {
      const text = 'This Is Title Case. Every Word Starts With Capital. Very Formal Looking.';
      expect(analyzeCasingFromText(text)).toBe(CasingStyle.TITLE_CASE);
    });

    it('correctly analyzes sentence case text', () => {
      const text =
        'This is sentence case. Only first word capitalized. Like normal writing. Very common.';
      expect(analyzeCasingFromText(text)).toBe(CasingStyle.SENTENCE_CASE);
    });

    it('correctly analyzes uppercase text', () => {
      const text = 'ALL CAPS HERE. EVERYTHING IS UPPERCASE. VERY LOUD WRITING. LIKE SHOUTING.';
      expect(analyzeCasingFromText(text)).toBe(CasingStyle.UPPERCASE);
    });

    it('handles complex punctuation correctly', () => {
      const text = 'Hello world! This is a test? yes, it is. testing, testing.';
      expect(analyzeCasingFromText(text)).toBe(CasingStyle.SENTENCE_CASE);
    });

    it('handles single-sentence text', () => {
      expect(analyzeCasingFromText('This is just one sentence')).toBe(CasingStyle.SENTENCE_CASE);
      expect(analyzeCasingFromText('all lowercase here')).toBe(CasingStyle.LOWERCASE);
      expect(analyzeCasingFromText('This Is Title Case Example')).toBe(CasingStyle.TITLE_CASE);
    });

    it('handles empty or whitespace text', () => {
      expect(analyzeCasingFromText('')).toBe(CasingStyle.SENTENCE_CASE);
      expect(analyzeCasingFromText('  ')).toBe(CasingStyle.SENTENCE_CASE);
    });
  });

  describe('analyzeCasingFromHumanAnswers', () => {
    it('correctly analyzes lowercase answers', () => {
      const answers = [
        'i prefer lowercase',
        'yeah me too no caps',
        'this is my style of typing',
        'keeps things casual',
      ];
      expect(analyzeCasingFromHumanAnswers(answers)).toBe(CasingStyle.LOWERCASE);
    });

    it('correctly analyzes title case answers', () => {
      const answers = [
        'I Always Type Like This',
        'Every Word Gets A Capital',
        'It Looks More Important This Way',
        'Title Case Is My Preference',
      ];
      expect(analyzeCasingFromHumanAnswers(answers)).toBe(CasingStyle.TITLE_CASE);
    });

    it('correctly analyzes sentence case answers', () => {
      const answers = [
        'I write normally. With regular capitalization.',
        'This is how most people type. Just standard rules.',
        'Only the first word of each sentence. And proper nouns like John.',
        'Standard English capitalization. Nothing special.',
      ];
      expect(analyzeCasingFromHumanAnswers(answers)).toBe(CasingStyle.SENTENCE_CASE);
    });

    it('correctly analyzes uppercase answers', () => {
      const answers = [
        'I TYPE EVERYTHING IN CAPS',
        'ALL UPPERCASE ALL THE TIME',
        'MAKES IT LOOK LIKE I AM SHOUTING',
        'VERY ATTENTION-GRABBING STYLE',
      ];
      expect(analyzeCasingFromHumanAnswers(answers)).toBe(CasingStyle.UPPERCASE);
    });

    it('handles mixed casing styles across answers', () => {
      const answers = [
        'Sometimes I Use Title Case',
        'but other times i use lowercase',
        'It really depends on my mood',
        'Consistency Is Not My Strong Point',
      ];
      // The result depends on the dominant style across all sentences
      // In this case, there's no clear dominant style so it falls back to sentence case
      expect(analyzeCasingFromHumanAnswers(answers)).toBe(CasingStyle.SENTENCE_CASE);
    });

    it('handles answers with multiple sentences', () => {
      const answers = [
        'i type in lowercase. never use caps. it is easier.',
        'no need for shift key. saves time. looks cool.',
        'this is my preference. always been this way.',
      ];
      expect(analyzeCasingFromHumanAnswers(answers)).toBe(CasingStyle.LOWERCASE);
    });

    it('handles empty or undefined answers', () => {
      expect(analyzeCasingFromHumanAnswers([''])).toBe(CasingStyle.SENTENCE_CASE);
      expect(analyzeCasingFromHumanAnswers(['', undefined as unknown as string])).toBe(
        CasingStyle.SENTENCE_CASE
      );
    });

    it('properly combines all sentences from all answers', () => {
      const answers = [
        'This is sentence case. But This Part Is Title Case.',
        'another lowercase sentence. And A Title Case One.',
        'More lowercase here. And More Title Case Here.',
      ];
      // There should be 3 sentence case, 3 title case sentences
      // No dominant style, so defaults to sentence case
      expect(analyzeCasingFromHumanAnswers(answers)).toBe(CasingStyle.SENTENCE_CASE);

      const titleDominant = [
        'This Is Title Case. This Is Also Title Case.',
        'Another Set Of Title Case. Once More With Title.',
        'Just One Not Title case. But This One Is.',
      ];
      // Should have mostly title case sentences
      expect(analyzeCasingFromHumanAnswers(titleDominant)).toBe(CasingStyle.TITLE_CASE);
    });
  });
});
