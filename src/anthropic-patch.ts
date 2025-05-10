import { Anthropic } from '@anthropic-ai/sdk';

// Response type for Anthropic API
interface AnthropicResponse {
  content: Array<{
    text?: string;
    type?: string;
  }>;
}

// Helper function to safely extract text from Anthropic response
function extractTextFromResponse(response: AnthropicResponse): string {
  try {
    if (!response || !response.content || response.content.length === 0) return '';
    const contentBlock = response.content[0];
    return contentBlock && 'text' in contentBlock && contentBlock.text
      ? contentBlock.text.trim()
      : '';
  } catch (error) {
    console.error('Error extracting text from response:', error);
    return '';
  }
}

export { extractTextFromResponse };
