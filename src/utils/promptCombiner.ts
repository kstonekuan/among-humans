/**
 * Utility functions for combining prompts
 *
 * These functions were extracted from server.ts to make them testable
 */

/**
 * Helper function to extract unique instructions/topics from prompts
 * @param prompts Array of user-provided prompts
 * @returns Array of unique instructions/topics
 */
function extractUniqueItems(prompts: string[]): string[] {
  // Extract unique instructions by splitting and trimming
  const uniqueItems = new Set<string>();

  // Process each player's input
  for (const prompt of prompts) {
    // Split by punctuation to get separate items
    const items = prompt
      .split(/[.,;!?]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    // Add each unique item
    for (const item of items) {
      if (item.length > 0) {
        uniqueItems.add(item);
      }
    }
  }

  // Convert back to an array
  return Array.from(uniqueItems);
}

/**
 * Combines imposter prompts from multiple players
 * @param prompts Array of player-provided prompts
 * @param basePrompt Base prompt to use for AI behavior instructions
 * @returns Combined prompt with all unique instructions
 */
export function combineImposterPrompts(prompts: string[], basePrompt: string): string {
  // If no additional prompts, just return the base prompt
  if (prompts.length === 0) return basePrompt;

  // If only one prompt, combine it with the base prompt
  if (prompts.length === 1) return `${basePrompt} Also, ${prompts[0]}`;

  // Extract unique instructions
  const uniqueInstructions = extractUniqueItems(prompts);

  // Create a cohesive prompt by joining the instructions
  // Format: "Base prompt. Also: [player instructions joined with periods]"
  return `${basePrompt} Also: ${uniqueInstructions.join('. ')}`;
}
