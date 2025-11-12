// Shared type definitions for client and server

// Base player type with all possible properties
export type Player = {
	id: string;
	name: string;
	score: number;
	isAI: boolean;
	isReady?: boolean;
	hasAnswered?: boolean;
	hasVotedThisRound?: boolean;
	roomCode?: string;
	customQuestion?: string;
	isActive?: boolean;
	// Client-side only properties
	answer?: string;
	time?: number;
};

export type Answer = {
	playerId: string;
	answer: string;
};

export type RoundData = {
	prompt: string | null;
	answers: Record<string, Answer>;
	participants: Record<string, Player>;
	currentVotes: Record<string, string>;
};

export type GameState = "waiting" | "challenge" | "results" | "voting";

export type Room = {
	code: string;
	players: Record<string, Player>;
	gameState: GameState;
	isGameStarted: boolean;
	currentRoundData: RoundData;
	aiPlayerId: string;
	currentAiPlayerName: string;
	aiPlayerActive: boolean;
	playerImposterPrompts: Record<string, string>;
	combinedImposterPrompt?: string;
	playerQuestionPrompts: Record<string, string>;
	combinedQuestionPrompt?: string;
	usedQuestions: string[];
	generatedQuestions: Array<{
		question: string;
		topic?: string;
		used: boolean;
	}>;
	totalRounds: number;
	currentRound: number;
	roundsCompleted: boolean;
	allRoundsVotes: Array<{
		roundNumber: number;
		votes: Record<string, string>;
	}>;
	roundsHistory: Array<{
		roundNumber: number;
		prompt: string;
		answers: Record<string, Answer>;
	}>;
	playerVotesReceived: Record<string, number>;
	playerAIDetectionSuccess: Record<string, number>;
};

// Client-side specific types
export type PublicAnswer = {
	name: string;
	answer: string;
	time?: number;
};

export type VoteData = {
	participants: Record<string, Player>;
	aiPlayer: Player;
};

export type VoteResults = {
	players: Record<string, Player>;
	winners: string[];
	message: string;
	aiPlayer: Player;
	allRoundsVotes?: Array<{
		roundNumber: number;
		votes: Record<string, string>;
	}>;
	currentRound?: number;
	totalRounds?: number;
	isLastRound?: boolean;
	revealAI?: boolean;
	playerVotesReceived?: Record<string, number>;
	playerAIDetectionSuccess?: Record<string, number>;
	combinedImposterPrompt?: string;
	playerImposterPrompts?: Record<string, string>;
	currentPrompt?: string;
	questionPromptCount?: number;
	combinedQuestionPrompt?: string;
	playerQuestionPrompts?: Record<string, string>;
};

export type RoomData = {
	roomCode: string;
	player: Player;
	isReconnection?: boolean;
};

export type GameComplete = {
	playerAIDetectionSuccess: Record<string, number>;
	playerVotesReceived: Record<string, number>;
	aiPlayer: Player;
	players: Record<string, Player>;
	questionPromptCount?: number;
	combinedQuestionPrompt?: string;
	combinedImposterPrompt?: string;
	playerImposterPrompts?: Record<string, string>;
	playerQuestionPrompts?: Record<string, string>;
	currentPrompt?: string;
	allRoundsVotes?: Array<{
		roundNumber: number;
		votes: Record<string, string>;
	}>;
	roundsHistory?: Array<{
		roundNumber: number;
		prompt: string;
		answers: Record<string, Answer>;
	}>;
};
