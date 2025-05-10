import { describe, expect, it } from 'vitest';
import { combineImposterPrompts, combineQuestionPrompts } from '../../src/utils/promptCombiner';

describe('Prompt Combination Functions', () => {
  describe('combineImposterPrompts', () => {
    const testBasePrompt = 'Test base prompt for AI impersonation';

    it('returns the base prompt when no additional prompts are provided', () => {
      const result = combineImposterPrompts([], testBasePrompt);
      expect(result).toBe(testBasePrompt);
    });

    it('combines single prompt properly with the base prompt', () => {
      const result = combineImposterPrompts(['use lots of emojis'], testBasePrompt);
      expect(result).toBe(`${testBasePrompt} Also, use lots of emojis`);
    });

    it('handles multiple prompts by combining them with periods', () => {
      const result = combineImposterPrompts(
        ['use lots of emojis', 'mention food in your answer'],
        testBasePrompt
      );
      expect(result).toContain(testBasePrompt);
      expect(result).toContain('use lots of emojis');
      expect(result).toContain('mention food in your answer');
      expect(result).toContain('Also:');
    });

    it('splits prompts containing multiple instructions with punctuation', () => {
      const result = combineImposterPrompts(
        ['use emojis. mention a pet. reference the weather'],
        testBasePrompt
      );

      expect(result).toContain(testBasePrompt);
      expect(result).toContain('use emojis');
      expect(result).toContain('mention a pet');
      expect(result).toContain('reference the weather');
    });

    it('removes duplicate instructions', () => {
      const result = combineImposterPrompts(
        ['be funny. use humor', 'be funny. use silly words'],
        testBasePrompt
      );

      // Count occurrences of "be funny" in the result
      const matches = result.match(/be funny/g) || [];
      expect(matches.length).toBe(1);

      expect(result).toContain('use humor');
      expect(result).toContain('use silly words');
    });

    it('filters out empty instructions', () => {
      const result = combineImposterPrompts(['use emojis. . mention a pet', ''], testBasePrompt);

      expect(result).toContain(testBasePrompt);
      expect(result).toContain('use emojis');
      expect(result).toContain('mention a pet');
      expect(result).not.toMatch(/\.\s+\./);
    });
  });

  describe('combineQuestionPrompts', () => {
    const testBasePrompt = 'Test base prompt for question generation';

    it('returns the base prompt when no additional prompts are provided', () => {
      const result = combineQuestionPrompts([], testBasePrompt);
      expect(result).toBe(testBasePrompt);
    });

    it('formats single prompt correctly', () => {
      const result = combineQuestionPrompts(['travel experiences'], testBasePrompt);
      expect(result).toBe(`${testBasePrompt}. Specifically, ask about: travel experiences`);
    });

    it('combines multiple topic prompts', () => {
      const result = combineQuestionPrompts(
        ['childhood memories', 'favorite movies'],
        testBasePrompt
      );

      expect(result).toContain(testBasePrompt);
      expect(result).toContain('Include a mix of these topics:');
      expect(result).toContain('childhood memories');
      expect(result).toContain('favorite movies');
    });

    it('splits prompts containing multiple topics with punctuation', () => {
      const result = combineQuestionPrompts(
        ['travel experiences. food preferences. hobbies'],
        testBasePrompt
      );

      expect(result).toContain(testBasePrompt);
      expect(result).toContain('travel experiences');
      expect(result).toContain('food preferences');
      expect(result).toContain('hobbies');
    });

    it('removes duplicate topics', () => {
      const result = combineQuestionPrompts(
        ['travel. adventures. journeys', 'travel. favorite foods'],
        testBasePrompt
      );

      // Count occurrences of "travel" in the result
      const matches = result.match(/travel/g) || [];
      expect(matches.length).toBe(1);

      expect(result).toContain('adventures');
      expect(result).toContain('journeys');
      expect(result).toContain('favorite foods');
    });

    it('filters out empty topics', () => {
      const result = combineQuestionPrompts(['hobbies. . pets', ''], testBasePrompt);

      expect(result).toContain(testBasePrompt);
      expect(result).toContain('hobbies');
      expect(result).toContain('pets');
      expect(result).not.toMatch(/\.\s+\./);
    });
  });
});
