import { describe, expect, it } from "vitest";
import { combineImposterPrompts } from "../../src/utils/promptCombiner";

describe("Prompt Combination Functions", () => {
	describe("combineImposterPrompts", () => {
		const testBasePrompt = "Test base prompt for AI impersonation";

		it("returns the base prompt when no additional prompts are provided", () => {
			const result = combineImposterPrompts([], testBasePrompt);
			expect(result).toBe(testBasePrompt);
		});

		it("combines single prompt properly with the base prompt", () => {
			const result = combineImposterPrompts(
				["use lots of emojis"],
				testBasePrompt,
			);
			expect(result).toBe(`${testBasePrompt} Also, use lots of emojis`);
		});

		it("handles multiple prompts by combining them with periods", () => {
			const result = combineImposterPrompts(
				["use lots of emojis", "mention food in your answer"],
				testBasePrompt,
			);
			expect(result).toContain(testBasePrompt);
			expect(result).toContain("use lots of emojis");
			expect(result).toContain("mention food in your answer");
			expect(result).toContain("Also:");
		});

		it("splits prompts containing multiple instructions with punctuation", () => {
			const result = combineImposterPrompts(
				["use emojis. mention a pet. reference the weather"],
				testBasePrompt,
			);

			expect(result).toContain(testBasePrompt);
			expect(result).toContain("use emojis");
			expect(result).toContain("mention a pet");
			expect(result).toContain("reference the weather");
		});

		it("removes duplicate instructions", () => {
			const result = combineImposterPrompts(
				["be funny. use humor", "be funny. use silly words"],
				testBasePrompt,
			);

			// Count occurrences of "be funny" in the result
			const matches = result.match(/be funny/g) || [];
			expect(matches.length).toBe(1);

			expect(result).toContain("use humor");
			expect(result).toContain("use silly words");
		});

		it("filters out empty instructions", () => {
			const result = combineImposterPrompts(
				["use emojis. . mention a pet", ""],
				testBasePrompt,
			);

			expect(result).toContain(testBasePrompt);
			expect(result).toContain("use emojis");
			expect(result).toContain("mention a pet");
			expect(result).not.toMatch(/\.\s+\./);
		});
	});
});
