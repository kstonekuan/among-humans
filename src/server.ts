import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import OpenAI from 'openai';
import { Server } from 'socket.io';
import { extractTextFromResponse } from './openai-patch';
import { analyzeCasingFromHumanAnswers, casingStyleToString } from './utils/casingAnalyzer';
import { getRandomPlayerName, playerNames } from './utils/nameGenerator';
import { combineImposterPrompts } from './utils/promptCombiner';

// Load environment variables
dotenv.config();

// Initialize LLM client
let openai: OpenAI;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('ERROR: Missing OPENAI_API_KEY environment variable');
  process.exit(1);
} else {
  openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
  });
  console.log('OpenAI API client initialized');
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;

// Create HTTP server
const httpServer = http.createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

// Server-side game state
type Player = {
  id: string;
  name: string;
  score: number;
  isAI: boolean;
  hasAnswered?: boolean;
  hasVotedThisRound?: boolean;
  roomCode?: string;
  customQuestion?: string; // Player's custom question suggestion
};

type Answer = {
  playerId: string;
  answer: string;
  timeSpent: number;
};

type RoundData = {
  prompt: string | null;
  answers: Record<string, Answer>;
  participants: Record<string, Player>;
  currentVotes: Record<string, string>;
};

type Room = {
  code: string;
  players: Record<string, Player>;
  gameState: 'waiting' | 'challenge' | 'results' | 'voting';
  isGameStarted: boolean;
  currentRoundData: RoundData;
  aiPlayerId: string;
  currentAiPlayerName: string;
  aiPlayerActive: boolean;
  playerImposterPrompts: Record<string, string>; // Collection of player-provided imposter prompts
  combinedImposterPrompt?: string; // The final combined imposter prompt
  playerQuestionPrompts: Record<string, string>; // Collection of player-provided prompts for question generation
  combinedQuestionPrompt?: string; // The final combined prompt for question generation

  // Store previously used questions to avoid repetition
  usedQuestions: string[]; // Array of previously used questions

  // Store pre-generated questions for all rounds
  generatedQuestions: Array<{
    question: string;
    topic?: string; // The player topic this question focuses on
    used: boolean; // Whether this question has been used
  }>;

  // Track AI answer generation
  pendingAIAnswerPromise?: Promise<void>; // Promise for AI answer generation in progress

  // Round configuration
  totalRounds: number;
  currentRound: number;
  roundsCompleted: boolean;

  // Track votes across rounds
  allRoundsVotes: Array<{
    roundNumber: number;
    votes: Record<string, string>; // voterId -> votedForId
  }>;

  // Track votes received per player
  playerVotesReceived: Record<string, number>; // playerId -> number of votes received

  // Track AI detection success
  playerAIDetectionSuccess: Record<string, number>; // playerId -> number of correct AI detections
};

// Generate a random 6-character room code
function generateRoomCode(): string {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Omitting similar-looking characters
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}

// Store all active rooms
const rooms: Record<string, Room> = {};

// Game prompts
const gamePrompts = [
  'Describe your perfect Sunday in one sentence',
  'What would you do if you won the lottery?',
  'If you could have dinner with any historical figure, who would it be and why?',
  'What is the most adventurous thing you have ever done?',
  'What is your most unpopular opinion?',
  'If you could have any superpower, what would it be and how would you use it?',
  'What was your childhood dream job?',
  'If you could teleport anywhere right now, where would you go?',
  'What is one food you absolutely cannot stand?',
  'What is the best piece of advice you have ever received?',
];

// Fallback function to generate a new prompt when all pre-generated questions are used
async function generatePromptWithAI(room: Room): Promise<string> {
  try {
    // If no question prompts provided, use a random default prompt
    if (Object.keys(room.playerQuestionPrompts).length === 0 || !room.combinedQuestionPrompt) {
      return getUnusedDefaultPrompt(room);
    }

    // Create a prompt for generating a question
    const promptGen = `
    You are generating a question for a social deduction game. Players will answer this question, 
    and one of the players will be secretly replaced by an AI. The others need to figure out who the AI is.
    
    These are examples of good questions:
    ${gamePrompts.join('\n')}
    
    ${
      room.usedQuestions.length > 0
        ? `The following questions have already been used and should NOT be repeated:
    ${room.usedQuestions.join('\n')}`
        : ''
    }
    
    Instructions for the type of question to generate:
    ${room.combinedQuestionPrompt}
    
    Generate ONE new question that fits these instructions and is similar in style to the examples.
    The question should be concise (1-2 sentences), open-ended, and can be answered briefly in a casual conversation.
    Include no commentary, just the question itself.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [{ role: 'user', content: promptGen }],
    });

    // Extract generated question
    const generatedQuestion = extractTextFromResponse(response);
    console.log(`[ROOM] Generated fallback question for room ${room.code}: ${generatedQuestion}`);

    return generatedQuestion || getUnusedDefaultPrompt(room);
  } catch (error) {
    console.error('Error generating question with AI:', error);
    return getUnusedDefaultPrompt(room);
  }
}

// Helper function to get an unused default prompt
function getUnusedDefaultPrompt(room: Room): string {
  let newPrompt = gamePrompts[Math.floor(Math.random() * gamePrompts.length)];
  let attempts = 0;

  // Try to find an unused prompt, up to 20 attempts
  while (room.usedQuestions.includes(newPrompt) && attempts < 20) {
    newPrompt = gamePrompts[Math.floor(Math.random() * gamePrompts.length)];
    attempts++;
  }

  return newPrompt;
}

// Function to generate multiple questions at once
async function generateMultipleQuestions(room: Room): Promise<void> {
  try {
    console.log(`[ROOM] Generating batch of questions for room ${room.code}`);

    // Get player-suggested topics
    let topics: string[] = [];

    // If there are player-suggested topics, extract them
    if (Object.keys(room.playerQuestionPrompts).length > 0) {
      topics = Object.values(room.playerQuestionPrompts).flatMap((prompt) =>
        prompt
          .split(/[.,;!?]/)
          .map((topic) => topic.trim())
          .filter((topic) => topic.length > 0),
      );

      console.log(`[ROOM] Extracted ${topics.length} topics for room ${room.code}`);
    }

    // Determine number of questions to generate (rounds + 2 extra for variety)
    const questionsToGenerate = room.totalRounds + 2;

    // If no player topics, use default prompts
    if (topics.length === 0) {
      console.log(`[ROOM] No player topics for room ${room.code}, using default prompts`);
      // Use default game prompts as the source
      const shuffledPrompts = [...gamePrompts]
        .sort(() => Math.random() - 0.5)
        .slice(0, questionsToGenerate);

      // Add to generated questions
      room.generatedQuestions = shuffledPrompts.map((question) => ({
        question,
        used: false,
      }));

      return;
    }

    // Ensure we have enough topics (repeating if necessary)
    if (topics.length < questionsToGenerate) {
      const originalTopics = [...topics];
      while (topics.length < questionsToGenerate) {
        topics = [...topics, ...originalTopics];
      }
    }

    // Shuffle topics to make the selection random
    const shuffledTopics = topics.sort(() => Math.random() - 0.5).slice(0, questionsToGenerate);

    // Create prompt to generate multiple questions, each focused on a single topic
    const promptGen = `
    You are generating questions for a social deduction game. Players will answer these questions, 
    and one of the players will be secretly replaced by an AI. The others need to figure out who the AI is.
    
    These are examples of good questions:
    ${gamePrompts.join('\n')}
    
    I will provide you with ${shuffledTopics.length} different topics suggested by players.
    For each topic, generate EXACTLY ONE engaging question focused specifically on that topic.
    
    Each question should be:
    - Concise (1-2 sentences)
    - Open-ended but able to be answered briefly
    - Casual and conversational in tone
    - Focused on the specific topic provided
    - Different from the example questions
    
    The topics are:
    ${shuffledTopics.map((topic, i) => `${i + 1}. ${topic}`).join('\n')}
    
    Format your response as a numbered list, with ONE question per topic:
    1. [Question for topic 1]
    2. [Question for topic 2]
    ...and so on.
    
    IMPORTANT: Generate EXACTLY ${shuffledTopics.length} questions, one per topic. 
    Number them from 1 to ${shuffledTopics.length}.
    Include no commentary, just the numbered list of questions.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [{ role: 'user', content: promptGen }],
    });

    // Extract generated questions
    const responseText = extractTextFromResponse(response);

    // Parse the numbered list of questions
    const questionRegex = /\d+\.\s+(.*?)(?=\n\d+\.|$)/gs;
    const matches = [...responseText.matchAll(questionRegex)];

    // Create the questions array with their corresponding topics
    const generatedQuestions = matches.map((match, index) => ({
      question: match[1].trim(),
      topic: shuffledTopics[index],
      used: false,
    }));

    // If we didn't get enough questions, fill in with defaults
    if (generatedQuestions.length < questionsToGenerate) {
      console.log(
        `[ROOM] Only generated ${generatedQuestions.length}/${questionsToGenerate} questions, adding defaults`,
      );

      // How many more do we need?
      const remaining = questionsToGenerate - generatedQuestions.length;

      // Add some default questions that weren't previously used
      const unusedDefaults = gamePrompts
        .filter((q) => !room.usedQuestions.includes(q))
        .sort(() => Math.random() - 0.5)
        .slice(0, remaining)
        .map((q) => ({
          question: q,
          used: false,
        }));

      // Combine the generated questions with the defaults
      room.generatedQuestions = [...generatedQuestions, ...unusedDefaults];
    } else {
      room.generatedQuestions = generatedQuestions;
    }

    console.log(
      `[ROOM] Generated ${room.generatedQuestions.length} questions for room ${room.code}`,
    );
  } catch (error) {
    console.error('Error generating multiple questions:', error);

    // Fall back to using default prompts if there's an error
    const shuffledPrompts = [...gamePrompts]
      .filter((q) => !room.usedQuestions.includes(q))
      .sort(() => Math.random() - 0.5)
      .slice(0, room.totalRounds + 2)
      .map((q) => ({
        question: q,
        used: false,
      }));

    room.generatedQuestions = shuffledPrompts;
    console.log(`[ROOM] Using ${room.generatedQuestions.length} default questions due to error`);
  }
}

// Function to select a prompt for the round
async function selectPromptForRound(room: Room): Promise<string> {
  // Check if we need to generate questions first
  if (room.generatedQuestions.length === 0) {
    console.log(`[ROOM] No pre-generated questions for room ${room.code}, generating now`);

    // Generate the batch of questions
    await generateMultipleQuestions(room);
  }

  // Find an unused question
  const unusedQuestion = room.generatedQuestions.find((q) => !q.used);

  if (unusedQuestion) {
    // Mark this question as used
    unusedQuestion.used = true;

    // Keep track of used questions to avoid repeats
    room.usedQuestions.push(unusedQuestion.question);

    console.log(
      `[ROOM] Selected pre-generated question for room ${room.code}: ${unusedQuestion.question}`,
    );

    if (unusedQuestion.topic) {
      console.log(`[ROOM] This question focuses on topic: ${unusedQuestion.topic}`);
    }

    return unusedQuestion.question;
  }

  // If all pre-generated questions are used, generate a new one as fallback
  console.log(`[ROOM] All pre-generated questions used for room ${room.code}, generating fallback`);

  // Generate a new question using the fallback function
  const fallbackPrompt = await generatePromptWithAI(room);

  // Add to used questions list
  room.usedQuestions.push(fallbackPrompt);

  console.log(
    `[ROOM] Used fallback question for ${room.code}. Total used: ${room.usedQuestions.length}`,
  );

  return fallbackPrompt;
}

// Each room has its own usedNames tracking for player name assignment

// Function to get filtered players based on game state
// During waiting state, don't include the AI player
function getFilteredPlayersForClient(room: Room): Record<string, Player> {
  // If not in waiting state, send all players in the room
  if (room.gameState !== 'waiting') {
    return room.players;
  }

  // In waiting state, filter out the AI player
  const filteredPlayers: Record<string, Player> = {};

  for (const id in room.players) {
    if (id !== room.aiPlayerId) {
      filteredPlayers[id] = room.players[id];
    }
  }

  return filteredPlayers;
}

// getRandomPlayerName is now imported from utils/nameGenerator.ts

// Reassign new random names to all players for a new round
function reassignPlayerNames(room: Room): void {
  // Reset used names list for this room
  const roomUsedNames: string[] = [];

  // Reassign names to all human players in the room
  for (const playerId in room.players) {
    // Skip the AI player
    if (playerId !== room.aiPlayerId) {
      room.players[playerId].name = getRandomPlayerName(roomUsedNames);
    }
  }

  // Notify clients in the room about player list update
  io.to(room.code).emit('update_players', getFilteredPlayersForClient(room));
}

// Function to get room from player socket id
function getRoomFromPlayerId(playerId: string): Room | null {
  // Find the room the player is in
  for (const roomCode in rooms) {
    if (rooms[roomCode].players[playerId]) {
      return rooms[roomCode];
    }
  }
  return null;
}

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Handle player disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);

    // Find player's room
    const room = getRoomFromPlayerId(socket.id);

    if (room) {
      // If AI disconnected (unlikely but good practice)
      if (socket.id === room.aiPlayerId) {
        room.aiPlayerActive = false;
      }

      // Remove player from the room
      delete room.players[socket.id];

      // Leave socket.io room
      socket.leave(room.code);

      // If room is empty, remove it
      if (Object.keys(room.players).length === 0) {
        delete rooms[room.code];
        console.log(`[ROOM] Room ${room.code} removed because it's empty`);
        console.log(`[ROOMS] Total active rooms: ${Object.keys(rooms).length}`);
      } else {
        // Notify all clients in the room about player list update
        io.to(room.code).emit('update_players', getFilteredPlayersForClient(room));

        // If game was in progress, end it
        if (room.gameState !== 'waiting') {
          room.gameState = 'waiting';
          io.to(room.code).emit('status_update', 'Game ended because a player left');

          // Show configuration UI to all remaining players
          io.to(room.code).emit('show_config_ui', { isFirstGame: !room.isGameStarted });

          // All remaining players can start the game
          io.to(room.code).emit('enable_start_button');
        }
      }
    }
  });

  // Handle create room
  socket.on('create_room', () => {
    // Generate a unique room code
    let roomCode = generateRoomCode();
    while (rooms[roomCode]) {
      roomCode = generateRoomCode();
    }

    // Log room creation
    console.log(`[ROOM] New room created: ${roomCode} by user ${socket.id}`);

    // Create room
    rooms[roomCode] = {
      code: roomCode,
      players: {},
      gameState: 'waiting',
      isGameStarted: false,
      currentRoundData: {
        prompt: null,
        answers: {},
        participants: {},
        currentVotes: {},
      },
      aiPlayerId: `bot_${roomCode}`,
      currentAiPlayerName: '',
      aiPlayerActive: false,
      playerImposterPrompts: {}, // Initialize empty imposter prompts object
      playerQuestionPrompts: {}, // Initialize empty question generation prompts object
      usedQuestions: [], // Initialize empty array to track used questions
      generatedQuestions: [], // Initialize empty array for pre-generated questions

      // Initialize round configuration with defaults
      totalRounds: 3, // Default to 3 rounds
      currentRound: 0,
      roundsCompleted: false,

      // Initialize empty tracking arrays/objects
      allRoundsVotes: [],
      playerVotesReceived: {},
      playerAIDetectionSuccess: {},
    };

    // Assign a random name to the player
    const usedNames: string[] = [];
    const randomName = getRandomPlayerName(usedNames);

    // Create new player
    const newPlayer = {
      id: socket.id,
      name: randomName,
      score: 0,
      isAI: false,
      roomCode,
    };

    // Add player to room
    rooms[roomCode].players[socket.id] = newPlayer;

    // Join socket.io room
    socket.join(roomCode);

    // Log player count in the new room
    console.log(`[ROOM] Room ${roomCode} has 1 player (creator)`);

    // Emit room joined event
    socket.emit('room_created', {
      roomCode,
      player: newPlayer,
    });

    // Notify room about player list update
    io.to(roomCode).emit('update_players', getFilteredPlayersForClient(rooms[roomCode]));

    // Show UI to all players with enabled start button
    io.to(roomCode).emit('show_config_ui', { isFirstGame: true });

    // All players can start the game
    io.to(roomCode).emit('enable_start_button');

    // Log active rooms
    const activeRoomCount = Object.keys(rooms).length;
    console.log(`[ROOMS] Total active rooms: ${activeRoomCount}`);
  });

  // Handle join room
  socket.on('join_room', (roomCode: string) => {
    // Validate room code
    if (!rooms[roomCode]) {
      socket.emit('room_error', 'Room not found');
      return;
    }

    const room = rooms[roomCode];

    // Don't allow joining if game in progress
    if (room.gameState !== 'waiting') {
      socket.emit('room_error', 'Game in progress, try again later');
      return;
    }

    // Assign a random name to the player
    const usedNames: string[] = [];
    const randomName = getRandomPlayerName(usedNames);

    // Create new player
    const newPlayer = {
      id: socket.id,
      name: randomName,
      score: 0,
      isAI: false,
      roomCode,
    };

    // Add player to room
    room.players[socket.id] = newPlayer;

    // Join socket.io room
    socket.join(roomCode);

    // Log player joining room
    console.log(`[ROOM] Player ${socket.id} joined room ${roomCode}`);
    console.log(`[ROOM] Room ${roomCode} now has ${Object.keys(room.players).length} players`);

    // Emit room joined event
    socket.emit('room_joined', {
      roomCode,
      player: newPlayer,
    });

    // Notify room about player list update
    io.to(roomCode).emit('update_players', getFilteredPlayersForClient(room));

    // Show configuration UI to the newly joined player
    if (room.gameState === 'waiting') {
      socket.emit('show_config_ui', { isFirstGame: !room.isGameStarted });
      // All players can start the game
      socket.emit('enable_start_button');

      // Send current rounds configuration if it's been set
      if (room.totalRounds !== 3) {
        // 3 is the default
        socket.emit('rounds_set', room.totalRounds);
        socket.emit('disable_rounds_input', room.totalRounds);
      }
    }
  });

  // The 'join_game' event is no longer needed since room selection is shown by default

  // Handle request to start a new round
  socket.on('request_start_round', () => {
    // Find player's room
    const room = getRoomFromPlayerId(socket.id);
    if (!room) return;

    // Don't start a new round if one is already in progress
    if (room.gameState !== 'waiting') return;

    // Check if we've already completed all rounds
    if (room.roundsCompleted) {
      socket.emit(
        'status_update',
        'All rounds have been completed. Start a new game for more rounds.',
      );
      return;
    }

    // Show loading indicator to all clients in the room
    io.to(room.code).emit('loading_game');

    // Activate AI player if needed
    if (!room.aiPlayerActive && Object.values(room.players).filter((p) => !p.isAI).length >= 1) {
      activateAIPlayer(room);
    }

    // Don't continue without AI player
    if (!room.aiPlayerActive) return;

    // Increment current round counter
    room.currentRound++;

    // Log round information
    console.log(
      `[ROOM] Room ${room.code} starting round ${room.currentRound} of ${room.totalRounds}`,
    );

    // Combine all player imposter prompts
    if (Object.keys(room.playerImposterPrompts).length > 0) {
      const prompts = Object.values(room.playerImposterPrompts);

      // Base prompt that ensures concise responses and sets general behavior
      const basePrompt = `Keep your answer very short (between 2-10 words). 
                      Be concise and direct. Remember that humans only 
                      have about 45 seconds to read and answer each question, 
                      so they typically give brief responses.
                      Try to write like it's a text message (minimal capitalization and punctuation).`;

      room.combinedImposterPrompt = combineImposterPrompts(prompts, basePrompt);
      console.log(`[ROOM] Combined ${prompts.length} imposter prompts for room ${room.code}`);
    }

    // Set game state to challenge
    room.gameState = 'challenge';

    // Check if this is the first round/game start
    if (!room.isGameStarted) {
      // Only randomize player names at game start
      reassignPlayerNames(room);

      // Mark the game as started
      room.isGameStarted = true;

      // Log that the game has started
      console.log(
        `[ROOM] Game started in room ${room.code} with ${Object.keys(room.players).length} players`,
      );

      // Generate all questions upfront for the entire game
      // Show loading indicator to clients
      io.to(room.code).emit('status_update', 'Generating unique questions for this game...');

      // First, clear any existing generated questions
      room.generatedQuestions = [];

      // Generate questions asynchronously - will be ready by the time we need them
      generateMultipleQuestions(room).catch((error) => {
        console.error(`[ROOM] Error pre-generating questions for room ${room.code}:`, error);
      });
    }

    // Generate a prompt using pre-generated questions or generate on-demand if needed
    selectPromptForRound(room)
      .then((prompt) => {
        room.currentRoundData.prompt = prompt;

        // Clear previous round data
        room.currentRoundData.answers = {};
        room.currentRoundData.currentVotes = {};

        // Store current players
        room.currentRoundData.participants = { ...room.players };

        // Reset answer and voting state for all participants
        for (const player of Object.values(room.currentRoundData.participants)) {
          player.hasAnswered = false;
          player.hasVotedThisRound = false;
        }

        // Define round duration (in milliseconds)
        const roundDuration = 45000; // 45 seconds

        // Emit start_challenge event to all clients in the room, including round info
        io.to(room.code).emit('start_challenge', {
          prompt: room.currentRoundData.prompt,
          duration: roundDuration,
          currentRound: room.currentRound,
          totalRounds: room.totalRounds,
        });

        // Send event to hide start button and AI prompt input for all players
        io.to(room.code).emit('hide_game_controls');

        // Trigger AI answer generation
        generateAIAnswer(room, room.currentRoundData.prompt, roundDuration);

        // Start round timer
        setTimeout(() => {
          // Auto-submit answers for any players who haven't answered yet
          const humanParticipants = Object.values(room.currentRoundData.participants).filter(
            (p) => !p.isAI,
          );
          for (const player of humanParticipants) {
            if (!player.hasAnswered && room.gameState === 'challenge') {
              console.log(
                `[ROOM] Auto-submitting answer for player ${player.id} in room ${room.code} because timer expired`,
              );

              // Create an empty answer for this player
              room.currentRoundData.answers[player.id] = {
                playerId: player.id,
                answer: '', // Empty answer
                timeSpent: 0, // Time's up
              };

              // Mark player as having answered
              player.hasAnswered = true;

              // Notify the client that their answer was auto-submitted
              io.to(player.id).emit('status_update', "Time's up! Your answer has been submitted.");
            }
          }

          // End the challenge phase
          endChallengePhase(room);
        }, roundDuration);
      })
      .catch((error) => {
        console.error('Error generating prompt:', error);

        // Fallback to a random prompt
        const randomIndex = Math.floor(Math.random() * gamePrompts.length);
        room.currentRoundData.prompt = gamePrompts[randomIndex];

        // Continue with the game using the fallback prompt
        // Clear previous round data
        room.currentRoundData.answers = {};
        room.currentRoundData.currentVotes = {};

        // Store current players
        room.currentRoundData.participants = { ...room.players };

        // Reset answer and voting state for all participants
        for (const player of Object.values(room.currentRoundData.participants)) {
          player.hasAnswered = false;
          player.hasVotedThisRound = false;
        }

        // Define round duration (in milliseconds)
        const roundDuration = 30000; // 30 seconds

        // Emit start_challenge event to all clients in the room, including round info
        io.to(room.code).emit('start_challenge', {
          prompt: room.currentRoundData.prompt,
          duration: roundDuration,
          currentRound: room.currentRound,
          totalRounds: room.totalRounds,
        });

        // Send event to hide start button and AI prompt input for all players
        io.to(room.code).emit('hide_game_controls');

        // Trigger AI answer generation
        generateAIAnswer(room, room.currentRoundData.prompt, roundDuration);

        // Start round timer
        setTimeout(() => {
          // Auto-submit answers for any players who haven't answered yet
          const humanParticipants = Object.values(room.currentRoundData.participants).filter(
            (p) => !p.isAI,
          );
          for (const player of humanParticipants) {
            if (!player.hasAnswered && room.gameState === 'challenge') {
              console.log(
                `[ROOM] Auto-submitting answer for player ${player.id} in room ${room.code} because timer expired`,
              );

              // Create an empty answer for this player
              room.currentRoundData.answers[player.id] = {
                playerId: player.id,
                answer: '', // Empty answer
                timeSpent: 0, // Time's up
              };

              // Mark player as having answered
              player.hasAnswered = true;

              // Notify the client that their answer was auto-submitted
              io.to(player.id).emit('status_update', "Time's up! Your answer has been submitted.");
            }
          }

          // End the challenge phase
          endChallengePhase(room);
        }, roundDuration);
      });
  });

  // Handle player submitting an answer
  socket.on('submit_answer', (data: { answer: string; timeSpent: number }) => {
    // Find player's room
    const room = getRoomFromPlayerId(socket.id);
    if (!room) return;

    // Validate round, player, and ensure they haven't answered yet
    if (
      room.gameState !== 'challenge' ||
      !room.players[socket.id] ||
      (room.currentRoundData.answers[socket.id] && room.currentRoundData.answers[socket.id].answer)
    ) {
      return;
    }

    // Store human answer
    room.currentRoundData.answers[socket.id] = {
      playerId: socket.id,
      answer: data.answer,
      timeSpent: data.timeSpent,
    };

    // Mark player as having answered
    if (room.currentRoundData.participants[socket.id]) {
      room.currentRoundData.participants[socket.id].hasAnswered = true;
    }

    // Check if all humans have answered
    const allHumansAnswered = Object.values(room.currentRoundData.participants)
      .filter((p) => !p.isAI)
      .every((p) => p.hasAnswered);

    // If all humans have answered, immediately generate AI answer and submit it
    if (allHumansAnswered) {
      // Cancel any pending AI answer timer/generation from the round start
      if (room.pendingAIAnswerPromise) {
        // Not a perfect cancellation but prevents double-answering
        console.log(`[ROOM] All humans answered in room ${room.code}, generating AI answer now`);
      }

      // Generate and immediately submit AI answer now that we have all human answers
      generateAndSubmitAIAnswer(room, room.currentRoundData.prompt)
        .then(() => {
          // End challenge phase once AI has answered
          endChallengePhase(room);
        })
        .catch((error) => {
          console.error('Error generating AI answer after all humans answered:', error);
          // Provide fallback answer
          if (room.gameState === 'challenge') {
            room.currentRoundData.answers[room.aiPlayerId] = {
              playerId: room.aiPlayerId,
              answer: 'Sorry, I was distracted. What was the question again?',
              timeSpent: 1000, // Very short time since we're answering immediately
            };

            // Mark AI as having answered
            if (room.currentRoundData.participants[room.aiPlayerId]) {
              room.currentRoundData.participants[room.aiPlayerId].hasAnswered = true;
            }

            // End the challenge phase
            endChallengePhase(room);
          }
        });
    }
  });

  // Handle player casting a vote
  socket.on('cast_vote', (votedPlayerId: string) => {
    // Check if player is in a room
    const room = getRoomFromPlayerId(socket.id);
    if (!room) return;

    // Validate game state, voter, and voted player
    if (
      room.gameState !== 'voting' ||
      !room.players[socket.id] ||
      !room.currentRoundData.participants[votedPlayerId] ||
      room.players[socket.id].hasVotedThisRound
    ) {
      return;
    }

    // Mark player as having voted
    room.players[socket.id].hasVotedThisRound = true;

    // Store vote
    room.currentRoundData.currentVotes[socket.id] = votedPlayerId;

    // Check if all players have voted
    const allPlayersVoted = Object.values(room.players)
      .filter((player) => !player.isAI) // Filter out AI player
      .every((player) => player.hasVotedThisRound);

    // If all human players have voted, end the voting phase immediately
    if (allPlayersVoted) {
      // Make sure AI also votes
      determineAndCastAIVote(room);
      // End voting phase
      endVotingPhase(room);
    }
  });

  // Handle request for player list update
  socket.on('request_players_update', () => {
    // Find player's room
    const room = getRoomFromPlayerId(socket.id);
    if (!room) return;

    // Send current player list to requesting client
    socket.emit('update_players', getFilteredPlayersForClient(room));
  });

  // Handle submitting an AI imposter prompt
  socket.on('submit_imposter_prompt', (data: { imposterPrompt: string }) => {
    // Find player's room
    const room = getRoomFromPlayerId(socket.id);
    if (!room) return;

    // Only allow submitting prompts in waiting state
    if (room.gameState !== 'waiting') {
      socket.emit('status_update', 'Cannot submit prompts while game is in progress');
      return;
    }

    // Check if player has already submitted a prompt
    if (room.playerImposterPrompts[socket.id]) {
      socket.emit('status_update', 'You have already submitted instructions for the AI imposter');
      return;
    }

    // Store the imposter prompt if provided
    if (data?.imposterPrompt) {
      room.playerImposterPrompts[socket.id] = data.imposterPrompt;

      // Notify all players that a player has influenced the AI
      io.to(room.code).emit(
        'status_update',
        `${
          room.players[socket.id]?.name || 'A player'
        } added their influence on how the AI imposter will behave.`,
      );

      // Send event to the player who submitted to disable their input
      socket.emit('disable_imposter_prompt');
    }
  });

  // Handle setting the number of rounds
  socket.on('set_rounds', (roundCount: number) => {
    // Find player's room
    const room = getRoomFromPlayerId(socket.id);
    if (!room) return;

    // Only allow setting rounds in waiting state and before game starts
    if (room.gameState !== 'waiting' || room.isGameStarted) {
      socket.emit('status_update', 'Cannot change rounds once the game has started');
      return;
    }

    // Validate round count (between 1-10)
    const validatedRoundCount = Math.min(Math.max(1, roundCount), 10);

    // Set round count
    room.totalRounds = validatedRoundCount;

    // Log configuration
    console.log(
      `[ROOM] Room ${room.code} configured for ${validatedRoundCount} rounds by player ${socket.id}`,
    );

    // Notify all room members
    io.to(room.code).emit('rounds_set', validatedRoundCount);
    io.to(room.code).emit('status_update', `Game configured for ${validatedRoundCount} rounds`);

    // Send event to disable rounds input for all players
    io.to(room.code).emit('disable_rounds_input', validatedRoundCount);
  });

  // Handle submitting a question generation prompt
  socket.on('submit_custom_question', (data: { customQuestion: string }) => {
    // Find player's room
    const room = getRoomFromPlayerId(socket.id);
    if (!room) return;

    // Only allow submitting question prompts in waiting state
    if (room.gameState !== 'waiting') {
      socket.emit('status_update', 'Cannot submit question prompts while game is in progress');
      return;
    }

    // Store the question prompt if provided
    if (data?.customQuestion) {
      room.playerQuestionPrompts[socket.id] = data.customQuestion;

      // Also store it in the player object for persistence
      if (room.players[socket.id]) {
        room.players[socket.id].customQuestion = data.customQuestion;
      }

      // Notify all players that a player has suggested question topics
      io.to(room.code).emit(
        'status_update',
        `${room.players[socket.id]?.name || 'A player'} suggested topics for the game's questions!`,
      );

      // Send event to the player who submitted to disable their input
      socket.emit('disable_custom_question');

      // Send the count of question prompts to all players
      const questionPromptCount = Object.keys(room.playerQuestionPrompts).length;
      io.to(room.code).emit('custom_question_count', questionPromptCount);
    }
  });
});

// The AI player will just get a random name from the same pool as human players

// Activate AI player
function activateAIPlayer(room: Room): void {
  // Don't activate if already active
  if (room.aiPlayerActive) return;

  // Create a list of used names in the room to ensure uniqueness
  const usedNames = Object.values(room.players).map((player) => player.name);

  // Get a random name for the AI player that's not already used by another player
  let aiName = getRandomPlayerName(usedNames);

  // In the unlikely event that all names are taken, append a number to make it unique
  if (!aiName) {
    const baseName = playerNames[Math.floor(Math.random() * playerNames.length)];
    aiName = `${baseName}${Math.floor(Math.random() * 100)}`;
  }

  // Create AI player
  room.players[room.aiPlayerId] = {
    id: room.aiPlayerId,
    name: aiName,
    score: 0,
    isAI: true,
    roomCode: room.code,
  };

  // Mark AI as active and store name
  room.aiPlayerActive = true;
  room.currentAiPlayerName = aiName;

  // Notify all clients in the room about player list update
  io.to(room.code).emit('update_players', getFilteredPlayersForClient(room));
}

/**
 * Shared function to generate an AI answer with current context
 * Used by both immediate answer generation and timed answer generation
 */
async function generateAIAnswerWithContext(
  room: Room,
  gamePrompt: string | null,
  options: {
    useCurrentRoundAnswersOnly?: boolean; // Whether to use only current round answers (for immediate/mid-round generation)
    immediateResponse?: boolean; // Whether this is an immediate response (affects timing)
  },
): Promise<{ answer: string; timeTaken: number } | null> {
  // Don't generate answer if AI is not active or prompt is null
  if (!room.aiPlayerActive || !gamePrompt) {
    return null;
  }

  // Default options
  const { useCurrentRoundAnswersOnly = false, immediateResponse = false } = options;

  try {
    // Log generation attempt
    console.log(
      `[ROOM] Generating AI answer for room ${room.code}${immediateResponse ? ' immediately' : ''}`,
    );

    // Collect human answers for context and analysis
    const humanAnswers: string[] = [];
    let totalAnswerLength = 0;
    let totalAnswerCount = 0;

    // If using only current round answers (immediate/mid-round generation)
    if (useCurrentRoundAnswersOnly) {
      // Process current round answers only
      for (const playerId in room.currentRoundData.answers) {
        if (playerId !== room.aiPlayerId) {
          const answer = room.currentRoundData.answers[playerId].answer;
          humanAnswers.push(answer);
          totalAnswerLength += answer.length;
          totalAnswerCount++;
        }
      }
    } else {
      // Otherwise include answers from previous rounds for more context
      const prevHumanAnswers: Record<string, Array<string>> = {};

      // Collect from previous rounds
      if (room.allRoundsVotes && room.allRoundsVotes.length > 0) {
        for (const round of room.allRoundsVotes) {
          // Skip the current round answers
          if (round.roundNumber === room.currentRound) continue;

          // Find answers for this round via the room's state
          for (const playerId in room.players) {
            if (playerId === room.aiPlayerId) continue;

            if (room.currentRoundData.answers[playerId]) {
              const answer = room.currentRoundData.answers[playerId].answer;

              // Initialize player's answer array if needed
              if (!prevHumanAnswers[playerId]) {
                prevHumanAnswers[playerId] = [];
              }

              // Add this answer
              prevHumanAnswers[playerId].push(answer);
              humanAnswers.push(answer);
              totalAnswerCount++;
              totalAnswerLength += answer.length;
            }
          }
        }
      }

      // Also include answers from the current round
      for (const playerId in room.currentRoundData.answers) {
        if (playerId === room.aiPlayerId) continue;

        const answer = room.currentRoundData.answers[playerId].answer;
        humanAnswers.push(answer);
        totalAnswerCount++;
        totalAnswerLength += answer.length;
      }
    }

    // Calculate average answer length to help the AI match
    const avgAnswerLength =
      totalAnswerCount > 0 ? Math.floor(totalAnswerLength / totalAnswerCount) : 50;
    const lengthThreshold = totalAnswerCount > 2 ? Math.floor(avgAnswerLength * 0.4) : 30; // 40% variation or default

    // Analyze casing style of human answers
    const casingStyleEnum = analyzeCasingFromHumanAnswers(humanAnswers);
    const casingStyle = casingStyleToString(casingStyleEnum);

    // Base imposter behavior - aligned with combineImposterPrompts function's basePrompt
    const baseImposterBehavior = `
    Keep your answer very short (between 2-10 words).
    Be concise and direct. Remember that humans only have about 45 seconds to read and answer each question.
    Try to write like it's a text message (minimal capitalization and punctuation).
    `;

    // Build prompt with current context
    let answerPrompt = `
    You are participating in a social deduction game where humans try to guess which participant is an AI.
    Your task is to write a convincing human-like answer to this prompt: "${gamePrompt}"
    
    Write a response that is believable as a human response. Do not be too verbose or technical.
    Use casual language, and possibly include minor grammatical errors or slang occasionally, but don't overdo it.
    ${baseImposterBehavior}
    `;

    // Include length guidance based on actual answers
    answerPrompt += `\nMake your answer around ${avgAnswerLength} characters long (plus or minus ${lengthThreshold} characters). This will help you blend in with the human responses.`;

    // Include casing style guidance
    answerPrompt += `\nUse ${casingStyle} in your answer to match the style of most human players.`;

    // Add human answers context (different approach based on mode)
    if (useCurrentRoundAnswersOnly && humanAnswers.length > 0) {
      // For immediate generation, include ALL current answers for perfect mimicry
      answerPrompt += `\n\nHere are all the human answers to the current question:
      ${humanAnswers.join('\n')}
      
      Your answer must be ORIGINAL and different from these examples, but should match their overall style, tone, and capitalization patterns. Don't directly copy any phrases or expressions, but do try to sound like part of this specific group.`;
    } else if (humanAnswers.length > 0) {
      // For scheduled generation, just use them as style examples
      answerPrompt += `\n\nHere are some example answers from other players to previous questions (not the current question):
      ${humanAnswers.slice(0, 5).join('\n')}
      
      Use these as style references only - your answer must be original and responsive to the current question. Match their overall style, tone, and capitalization patterns.`;
    }

    // Add any combined imposter instructions if available
    if (room.combinedImposterPrompt) {
      answerPrompt += `\n\nAdditional instructions from the players: ${room.combinedImposterPrompt}`;
    } else {
      // If no player-provided instructions, rely on the base imposter behavior
      answerPrompt += `\n\nAdditional instructions: ${baseImposterBehavior}`;
    }

    // Final instruction
    answerPrompt +=
      '\n\nONLY provide the answer, no explanations or context. Answer as a human would in a casual conversation.';

    // Send request to OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [{ role: 'user', content: answerPrompt }],
    });

    // Extract answer
    const aiAnswer = extractTextFromResponse(response);

    // Calculate response time based on mode
    let aiTimeTaken: number;

    if (immediateResponse) {
      // Very short time for immediate responses
      aiTimeTaken = 1000; // 1 second - as if AI just got the answer really quickly
    } else {
      // Simulate more realistic time for scheduled responses
      // Get average time spent by humans if available
      let avgTimeSpent = 5000; // Default 5 seconds
      let totalTime = 0;
      let playerCount = 0;

      for (const playerId in room.currentRoundData.answers) {
        if (playerId !== room.aiPlayerId) {
          totalTime += room.currentRoundData.answers[playerId].timeSpent;
          playerCount++;
        }
      }

      if (playerCount > 0) {
        avgTimeSpent = Math.floor(totalTime / playerCount);
      }

      // Add randomness but keep it in a reasonable range compared to humans
      const timeVariance = Math.floor(avgTimeSpent * 0.3); // 30% variance
      aiTimeTaken = avgTimeSpent + Math.random() * timeVariance * 2 - timeVariance;
    }

    return { answer: aiAnswer, timeTaken: aiTimeTaken };
  } catch (error) {
    console.error('Error generating AI answer:', error);

    // Return null on error, let the caller handle fallback behavior
    return null;
  }
}

// Generate and immediately submit AI answer after all humans have answered
async function generateAndSubmitAIAnswer(room: Room, gamePrompt: string | null): Promise<void> {
  try {
    // Generate AI answer with current round answers for context
    const result = await generateAIAnswerWithContext(room, gamePrompt, {
      useCurrentRoundAnswersOnly: true,
      immediateResponse: true,
    });

    // Handle result or error
    if (result) {
      // Store AI answer if still in challenge phase
      if (room.gameState === 'challenge') {
        room.currentRoundData.answers[room.aiPlayerId] = {
          playerId: room.aiPlayerId,
          answer: result.answer,
          timeSpent: result.timeTaken,
        };

        // Mark AI as having answered
        if (room.currentRoundData.participants[room.aiPlayerId]) {
          room.currentRoundData.participants[room.aiPlayerId].hasAnswered = true;
        }

        console.log(`[ROOM] AI answer submitted immediately for room ${room.code}`);
      }
    } else {
      // Handle error case
      throw new Error('Failed to generate AI answer');
    }
  } catch (error) {
    console.error('Error generating immediate AI answer:', error);
    throw error; // Let the caller handle the error
  }
}

// Scheduled AI answer generation function - used as a backup
// if players don't all answer before the timer ends
async function generateAIAnswer(
  room: Room,
  gamePrompt: string | null,
  _roundDuration: number,
): Promise<void> {
  // Store the promise for potential cancellation
  room.pendingAIAnswerPromise = (async () => {
    // Don't generate answer if AI is not active or prompt is null
    if (!room.aiPlayerActive || !gamePrompt) return;

    // Check if AI should still generate an answer (not all humans have answered)
    // This is to avoid generating an answer if we've already triggered the immediate answer
    const allHumansAnswered = Object.values(room.currentRoundData.participants)
      .filter((p) => !p.isAI)
      .every((p) => p.hasAnswered);

    if (allHumansAnswered) {
      console.log(`[ROOM] Skipping AI answer for room ${room.code} as all humans have answered`);
      return; // Skip generation as we'll use the immediate generation instead
    }

    try {
      // Generate AI answer using both current and previous round answers for context
      const result = await generateAIAnswerWithContext(room, gamePrompt, {
        useCurrentRoundAnswersOnly: false,
        immediateResponse: false,
      });

      // Handle result or error
      if (result) {
        // Store AI answer if still in challenge phase and not already answered
        if (room.gameState === 'challenge' && !room.currentRoundData.answers[room.aiPlayerId]) {
          room.currentRoundData.answers[room.aiPlayerId] = {
            playerId: room.aiPlayerId,
            answer: result.answer,
            timeSpent: result.timeTaken,
          };

          // Mark AI as having answered
          if (room.currentRoundData.participants[room.aiPlayerId]) {
            room.currentRoundData.participants[room.aiPlayerId].hasAnswered = true;
          }
        }
      } else {
        // Provide default answer in case of error (if not already answered)
        if (room.gameState === 'challenge' && !room.currentRoundData.answers[room.aiPlayerId]) {
          room.currentRoundData.answers[room.aiPlayerId] = {
            playerId: room.aiPlayerId,
            answer: 'Sorry, I was distracted. What was the question again?',
            timeSpent: 20000,
          };

          // Mark AI as having answered
          if (room.currentRoundData.participants[room.aiPlayerId]) {
            room.currentRoundData.participants[room.aiPlayerId].hasAnswered = true;
          }
        }
      }
    } catch (error) {
      console.error('Error generating AI answer:', error);

      // Provide default answer in case of error (if not already answered)
      if (room.gameState === 'challenge' && !room.currentRoundData.answers[room.aiPlayerId]) {
        room.currentRoundData.answers[room.aiPlayerId] = {
          playerId: room.aiPlayerId,
          answer: 'Sorry, I was distracted. What was the question again?',
          timeSpent: 20000,
        };

        // Mark AI as having answered
        if (room.currentRoundData.participants[room.aiPlayerId]) {
          room.currentRoundData.participants[room.aiPlayerId].hasAnswered = true;
        }
      }
    }
  })();
}

// End challenge phase
function endChallengePhase(room: Room): void {
  // Don't end if not in challenge phase
  if (room.gameState !== 'challenge') return;

  // First ensure all human participants have an answer entry before proceeding
  const humanParticipants = Object.values(room.currentRoundData.participants).filter(
    (p) => !p.isAI,
  );
  for (const player of humanParticipants) {
    if (!room.currentRoundData.answers[player.id]) {
      console.log(
        `[ROOM] Auto-creating empty answer for player ${player.id} in room ${room.code} in endChallengePhase`,
      );

      // Create an empty answer for this player
      room.currentRoundData.answers[player.id] = {
        playerId: player.id,
        answer: '', // Empty answer
        timeSpent: 0, // Time's up
      };

      // Mark player as having answered
      player.hasAnswered = true;
    }
  }

  // Collect all answers
  const collectedAnswers = Object.values(room.currentRoundData.participants).map((participant) => {
    const answer = room.currentRoundData.answers[participant.id];
    return {
      id: participant.id,
      name: participant.name,
      answer: answer ? answer.answer : '', // Use empty string instead of null
      time: answer ? answer.timeSpent : 0, // Use 0 instead of null
    };
  });

  // Proceed directly to showing public results and voting
  proceedToShowPublicResults(room, collectedAnswers);
}

// Define public answer type for client consumption
type PublicAnswerData = {
  id: string;
  name: string;
  answer: string | null;
  time: number | null;
};

// Show public results
function proceedToShowPublicResults(room: Room, answers: PublicAnswerData[]): void {
  // Set game state to results
  room.gameState = 'results';

  // Create a formatted array with all valid answers (exclude timing info)
  const formattedAnswers: Array<{ name: string; answer: string }> = [];

  // Process each answer - exclude time information to prevent AI identification
  for (const answer of answers) {
    // Include all answers, even if empty
    formattedAnswers.push({
      name: answer.name,
      answer: answer.answer || '', // Use empty string instead of null for empty answers
    });
  }

  // Randomly shuffle all answers using Fisher-Yates algorithm to hide the AI
  for (let i = formattedAnswers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [formattedAnswers[i], formattedAnswers[j]] = [formattedAnswers[j], formattedAnswers[i]];
  }

  // Emit show_public_answers event to all clients in this room
  io.to(room.code).emit('show_public_answers', formattedAnswers);

  // Start voting phase immediately
  startVotingPhase(room);
}

// Start voting phase
function startVotingPhase(room: Room): void {
  // Set game state to voting
  room.gameState = 'voting';

  // Clear previous votes
  room.currentRoundData.currentVotes = {};

  // Reset voting flags for all players
  for (const player of Object.values(room.players)) {
    player.hasVotedThisRound = false;
  }

  // Define voting duration (in milliseconds)
  const votingDuration = 20000; // 20 seconds

  // Emit start_voting event to all clients in this room with duration
  io.to(room.code).emit('start_voting', {
    participants: room.currentRoundData.participants,
    aiPlayer: { id: room.aiPlayerId, name: room.currentAiPlayerName },
    duration: votingDuration,
  });

  // AI will vote when last human votes or after a timeout
  // We don't need to set a timeout for ending voting phase as it will end when all players vote
}

// Determine and cast AI vote
function determineAndCastAIVote(room: Room): void {
  // Validate game state and AI player
  if (
    room.gameState !== 'voting' ||
    !room.aiPlayerActive ||
    room.currentRoundData.currentVotes[room.aiPlayerId]
  ) {
    return;
  }

  // Get all human players in this room
  const humanPlayers = Object.values(room.currentRoundData.participants).filter(
    (p) => !p.isAI && p.id !== room.aiPlayerId,
  );

  // If no humans to vote for, return
  if (humanPlayers.length === 0) return;

  // Tally human votes in this room
  const voteCounts: Record<string, number> = {};

  for (const voterId in room.currentRoundData.currentVotes) {
    const votedForId = room.currentRoundData.currentVotes[voterId];
    voteCounts[votedForId] = (voteCounts[votedForId] || 0) + 1;
  }

  // Determine AI vote target using strategy
  let aiVoteTarget = null;
  const random = Math.random();

  // Strategy 1 (50% chance): Vote for the player with the most votes
  if (random < 0.5) {
    let maxVotes = 0;
    let mostVotedPlayers: string[] = [];

    for (const playerId in voteCounts) {
      if (playerId !== room.aiPlayerId) {
        if (voteCounts[playerId] > maxVotes) {
          maxVotes = voteCounts[playerId];
          mostVotedPlayers = [playerId];
        } else if (voteCounts[playerId] === maxVotes) {
          mostVotedPlayers.push(playerId);
        }
      }
    }

    // If there are players with votes, randomly select one
    if (mostVotedPlayers.length > 0) {
      const randomIndex = Math.floor(Math.random() * mostVotedPlayers.length);
      aiVoteTarget = mostVotedPlayers[randomIndex];
    }
  }
  // Strategy 2 (30% chance): Vote for player with awkward answer heuristic
  else if (random < 0.8) {
    // In a real implementation, this would analyze answers for awkwardness
    // For now, just pick a random player
    const randomIndex = Math.floor(Math.random() * humanPlayers.length);
    aiVoteTarget = humanPlayers[randomIndex].id;
  }
  // Strategy 3 (20% chance): Vote for random human
  else {
    const randomIndex = Math.floor(Math.random() * humanPlayers.length);
    aiVoteTarget = humanPlayers[randomIndex].id;
  }

  // Cast AI vote if target was determined
  if (aiVoteTarget) {
    room.currentRoundData.currentVotes[room.aiPlayerId] = aiVoteTarget;
    console.log(`AI player in room ${room.code} voted for: ${aiVoteTarget}`);
  }
}

// End voting phase
function endVotingPhase(room: Room): void {
  // Don't end if not in voting phase
  if (room.gameState !== 'voting') return;

  // Ensure AI has voted
  determineAndCastAIVote(room);

  // Save round votes for historical tracking
  room.allRoundsVotes.push({
    roundNumber: room.currentRound,
    votes: { ...room.currentRoundData.currentVotes },
  });

  // Tally votes
  const votesReceived: Record<string, number> = {};

  for (const voterId in room.currentRoundData.currentVotes) {
    // Skip votes from the AI player when tallying votes
    if (voterId === room.aiPlayerId) continue;

    const votedForId = room.currentRoundData.currentVotes[voterId];
    votesReceived[votedForId] = (votesReceived[votedForId] || 0) + 1;

    // Update cumulative votes received across all rounds (excluding AI votes)
    room.playerVotesReceived[votedForId] = (room.playerVotesReceived[votedForId] || 0) + 1;
  }

  // Determine the player(s) with the most votes
  let maxVotes = 0;
  let mostVotedPlayerIds: string[] = [];

  for (const playerId in votesReceived) {
    if (votesReceived[playerId] > maxVotes) {
      maxVotes = votesReceived[playerId];
      mostVotedPlayerIds = [playerId];
    } else if (votesReceived[playerId] === maxVotes) {
      mostVotedPlayerIds.push(playerId);
    }
  }

  // Check if this was the final round
  const isLastRound = room.currentRound >= room.totalRounds;

  // Apply dual scoring logic
  const aiWasMostVoted = mostVotedPlayerIds.includes(room.aiPlayerId);
  const singleMostVotedPlayerId = mostVotedPlayerIds.length === 1 ? mostVotedPlayerIds[0] : null;
  let resultMessage = '';
  const roundWinners: string[] = [];

  // Keep track of correct AI detections
  for (const voterId in room.currentRoundData.currentVotes) {
    if (
      room.currentRoundData.currentVotes[voterId] === room.aiPlayerId &&
      voterId !== room.aiPlayerId
    ) {
      // Initialize player's detection success count if not already there
      if (!room.playerAIDetectionSuccess[voterId]) {
        room.playerAIDetectionSuccess[voterId] = 0;
      }
      // Increment success count
      room.playerAIDetectionSuccess[voterId] += 1;
    }
  }

  // Case 1: AI was caught
  if (aiWasMostVoted) {
    // Don't reveal it was the AI in the message unless it's the last round
    resultMessage = isLastRound
      ? `Round ${room.currentRound}: AI detected!`
      : `Round ${room.currentRound}: Voting complete!`;

    // Award points to correct human voters (+2)
    for (const voterId in room.currentRoundData.currentVotes) {
      if (
        room.currentRoundData.currentVotes[voterId] === room.aiPlayerId &&
        voterId !== room.aiPlayerId
      ) {
        if (room.players[voterId]) {
          room.players[voterId].score += 2;
          roundWinners.push(voterId);
        }
      }
    }
  }
  // Case 2: Single human was most voted
  else if (singleMostVotedPlayerId && singleMostVotedPlayerId !== room.aiPlayerId) {
    resultMessage = `Round ${room.currentRound}: ${
      room.players[singleMostVotedPlayerId]?.name || 'Human player'
    } received the most votes!`;

    // Award points to deceptive human (+3)
    if (room.players[singleMostVotedPlayerId]) {
      room.players[singleMostVotedPlayerId].score += 3;
      roundWinners.push(singleMostVotedPlayerId);
    }

    // Award points to AI for surviving (+1)
    if (room.players[room.aiPlayerId]) {
      room.players[room.aiPlayerId].score += 1;
      roundWinners.push(room.aiPlayerId);
    }
  }
  // Case 3: Tie or no votes
  else {
    resultMessage = `Round ${room.currentRound}: No consensus reached.`;

    // Award points to AI for surviving (+1)
    if (room.players[room.aiPlayerId]) {
      room.players[room.aiPlayerId].score += 1;
      roundWinners.push(room.aiPlayerId);
    }
  }

  if (isLastRound) {
    room.roundsCompleted = true;
    resultMessage += ' Final round completed!';
  }

  // Reset game state
  room.gameState = 'waiting';

  // Emit results to all clients in this room
  io.to(room.code).emit('show_vote_results', {
    players: room.players,
    winners: roundWinners,
    message: resultMessage,
    aiPlayer: { id: room.aiPlayerId, name: room.currentAiPlayerName },
    allRoundsVotes: room.allRoundsVotes,
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
    isLastRound: isLastRound,
    revealAI: isLastRound, // Only reveal AI on the last round
    playerVotesReceived: room.playerVotesReceived, // Add votes received for each player
    playerAIDetectionSuccess: isLastRound ? room.playerAIDetectionSuccess : undefined, // Only send detection stats on last round
    combinedImposterPrompt: isLastRound ? room.combinedImposterPrompt : undefined, // Only send combined prompt on last round
    // Send individual player prompts only in the last round
    playerImposterPrompts: isLastRound ? room.playerImposterPrompts : undefined,
    currentPrompt: room.currentRoundData.prompt, // Include the prompt that was used
    questionPromptCount: Object.keys(room.playerQuestionPrompts).length, // How many question prompts were submitted
    combinedQuestionPrompt: isLastRound ? room.combinedQuestionPrompt : undefined, // Only send combined prompt on last round
    // Send individual player question prompts only in the last round
    playerQuestionPrompts: isLastRound ? room.playerQuestionPrompts : undefined,
  });

  // Show configuration UI to all players if not the last round
  if (!isLastRound) {
    // Show UI to all players with Next Round button
    io.to(room.code).emit('show_config_ui', { isFirstGame: false });

    // All players can start the next round
    io.to(room.code).emit('enable_start_button');
  } else {
    // Emit game complete event
    io.to(room.code).emit('game_complete', {
      playerAIDetectionSuccess: room.playerAIDetectionSuccess,
      playerVotesReceived: room.playerVotesReceived,
      aiPlayer: { id: room.aiPlayerId, name: room.currentAiPlayerName },
      players: room.players,
      questionPromptCount: Object.keys(room.playerQuestionPrompts).length,
      combinedQuestionPrompt: room.combinedQuestionPrompt,
      combinedImposterPrompt: room.combinedImposterPrompt,
      // Add individual player imposter and question prompts
      playerImposterPrompts: room.playerImposterPrompts,
      playerQuestionPrompts: room.playerQuestionPrompts,
    });

    // Reset gameStarted flag to allow name randomization in the next game
    room.isGameStarted = false;
  }
}

// Start the server
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
