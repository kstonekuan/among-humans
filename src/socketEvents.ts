// TypeScript type definitions for Socket.IO events
import type { Server } from "socket.io";
import type {
	GameComplete,
	Player,
	PublicAnswer,
	RoomData,
	VoteResults,
} from "./types";

/**
 * Events that the server can emit to clients
 */
export interface ServerToClientEvents {
	// Room management events
	room_created: (data: RoomData) => void;
	room_joined: (data: RoomData & { isReconnection?: boolean }) => void;
	room_error: (errorMessage: string) => void;
	room_left: () => void;
	show_room_selection: () => void;

	// Player management events
	update_players: (players: Record<string, Player>) => void;

	// Game state events
	show_config_ui: (data: { isFirstGame: boolean }) => void;
	enable_start_button: () => void;
	loading_game: () => void;
	hide_game_controls: () => void;

	// Challenge/round events
	start_challenge: (data: {
		prompt: string | null;
		duration?: number;
		players?: Record<string, Player>;
		currentRound?: number;
		totalRounds?: number;
	}) => void;
	show_public_answers: (publicAnswers: PublicAnswer[]) => void;

	// Voting events
	start_voting: (data: {
		participants: Record<string, Player>;
		aiPlayer: { id: string; name: string };
	}) => void;
	show_vote_results: (data: VoteResults) => void;
	restore_vote_selection: (data: {
		votedPlayerId: string;
		playerName: string;
	}) => void;
	update_vote_statistics: (data: {
		playerVotesReceived: Record<string, number>;
	}) => void;

	// Configuration events
	rounds_set: (totalRounds: number) => void;
	disable_rounds_input: (roundCount: number) => void;
	disable_imposter_prompt: () => void;
	disable_custom_question: () => void;
	custom_question_count: (count: number) => void;

	// Game completion events
	game_complete: (data: GameComplete) => void;

	// Status and error events
	status_update: (message: string) => void;
	error: (message: string) => void;
}

/**
 * Events that clients can emit to the server
 */
export interface ClientToServerEvents {
	// Room management
	create_room: () => void;
	join_room: (data: string | { roomCode: string; playerName?: string }) => void;
	leave_room: () => void;

	// Player actions
	player_ready: (readyStatus: boolean) => void;
	request_start_round: () => void;
	submit_answer: (data: { answer: string }) => void;
	cast_vote: (votedPlayerId: string) => void;

	// Configuration
	set_rounds: (roundCount: number) => void;
	submit_imposter_prompt: (data: { imposterPrompt: string }) => void;
	submit_custom_question: (data: { customQuestion: string }) => void;

	// Utility
	request_players_update: () => void;
}

/**
 * Events for inter-server communication (for future scaling)
 */
interface InterServerEvents {
	ping: () => void;
}

/**
 * Data stored on each socket instance
 */
interface SocketData {
	userId: string;
	roomCode?: string;
}

/**
 * Typed Socket.IO Server instance
 */
export type TypedServer = Server<
	ClientToServerEvents,
	ServerToClientEvents,
	InterServerEvents,
	SocketData
>;
