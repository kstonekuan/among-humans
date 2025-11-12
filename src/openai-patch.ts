// Response type for OpenAI API
interface OpenAIResponse {
	choices: Array<{
		message?: {
			content?: string | null;
		};
		text?: string;
	}>;
}

// Helper function to filter out emoji characters from a string
function removeEmojis(text: string): string {
	// This regex pattern matches most emoji characters
	// It covers emoji in the Unicode ranges commonly used for emojis
	return text
		.replace(
			/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}\u{2B55}]/gu,
			"",
		)
		.trim();
}

// Helper function to safely extract text from OpenAI response
function extractTextFromResponse(response: OpenAIResponse): string {
	try {
		if (!response || !response.choices || response.choices.length === 0)
			return "";

		const choice = response.choices[0];

		// Handle both completion and chat completion formats
		let extractedText = "";
		if (choice.message?.content) {
			extractedText = choice.message.content.trim();
		} else if (choice.text) {
			extractedText = choice.text.trim();
		}

		// Remove emojis from the extracted text
		return removeEmojis(extractedText);
	} catch (error) {
		console.error("Error extracting text from response:", error);
		return "";
	}
}

export { extractTextFromResponse };
