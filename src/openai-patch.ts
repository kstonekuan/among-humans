// Response type for OpenAI API
interface OpenAIResponse {
  choices: Array<{
    message?: {
      content?: string | null;
    };
    text?: string;
  }>;
}

// Helper function to safely extract text from OpenAI response
function extractTextFromResponse(response: OpenAIResponse): string {
  try {
    if (!response || !response.choices || response.choices.length === 0) return '';

    const choice = response.choices[0];

    // Handle both completion and chat completion formats
    if (choice.message?.content) {
      return choice.message.content.trim();
    }

    if (choice.text) {
      return choice.text.trim();
    }

    return '';
  } catch (error) {
    console.error('Error extracting text from response:', error);
    return '';
  }
}

export { extractTextFromResponse };
