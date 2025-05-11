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

dotenv.config();

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

const app = express();
const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;

const httpServer = http.createServer(app);

const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, '../public')));

type Player = {
  id: string;
  name: string;
  score: number;
  isAI: boolean;
  isReady?: boolean;
  hasAnswered?: boolean;
  hasVotedThisRound?: boolean;
  roomCode?: string;
  customQuestion?: string;
  isActive?: boolean; // Flag to track if player is currently connected
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

  // Round configuration
  totalRounds: number;
  currentRound: number;
  roundsCompleted: boolean;

  // Track votes across rounds
  allRoundsVotes: Array<{
    roundNumber: number;
    votes: Record<string, string>; // voterId -> votedForId
  }>;

  // Track round history (for showing in final results)
  roundsHistory: Array<{
    roundNumber: number;
    prompt: string;
    answers: Record<string, Answer>; // playerId -> answer
  }>;

  // Track votes received per player
  playerVotesReceived: Record<string, number>; // playerId -> number of votes received

  // Track AI detection success
  playerAIDetectionSuccess: Record<string, number>; // playerId -> number of correct AI detections
};

function generateRoomCode(): string {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Omitting similar-looking characters
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}

const rooms: Record<string, Room> = {};

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

    console.log(`[LLM_CALL] Fallback Question Generator - room ${room.code}`);
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
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

    console.log(`[LLM_CALL] Batch Questions Generator - room ${room.code}`);
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
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

function getRoomFromPlayerId(playerId: string): Room | null {
  // Find the room the player is in
  for (const roomCode in rooms) {
    if (rooms[roomCode].players[playerId]) {
      return rooms[roomCode];
    }
  }
  return null;
}

function startGame(room: Room): void {
  // Don't start if game already in progress
  if (room.gameState !== 'waiting') return;

  // Check if we've already completed all rounds
  if (room.roundsCompleted) {
    io.to(room.code).emit(
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
    const basePrompt = `Keep your answer short.
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
    // Mark the game as started
    room.isGameStarted = true;

    // Log that the game has started
    console.log(
      `[ROOM] Game started in room ${room.code} with ${Object.keys(room.players).length} players`,
    );

    // Generate all questions upfront for the entire game
    generateMultipleQuestions(room)
      .then(() => {
        // Start the first round
        selectPromptForRound(room)
          .then((prompt) => {
            room.currentRoundData.prompt = prompt;
            startRound(room);
          })
          .catch((error) => {
            console.error('Error selecting prompt for first round:', error);
            room.gameState = 'waiting';
            io.to(room.code).emit('error', 'Failed to start game. Please try again.');
          });
      })
      .catch((error) => {
        console.error('Error generating questions:', error);
        room.gameState = 'waiting';
        io.to(room.code).emit('error', 'Failed to start game. Please try again.');
      });
  } else {
    // Starting a new round in an existing game
    selectPromptForRound(room)
      .then((prompt) => {
        room.currentRoundData.prompt = prompt;
        startRound(room);
      })
      .catch((error) => {
        console.error('Error selecting prompt for new round:', error);
        room.gameState = 'waiting';
        io.to(room.code).emit('error', 'Failed to start round. Please try again.');
      });
  }
}

function startRound(room: Room): void {
  // Reset round data
  room.currentRoundData.answers = {};
  room.currentRoundData.participants = {};
  room.currentRoundData.currentVotes = {};

  // Create a new entry in roundsHistory for the current round
  room.roundsHistory.push({
    roundNumber: room.currentRound,
    prompt: room.currentRoundData.prompt || '',
    answers: {},
  });

  // Add all active players to the current round participants
  for (const playerId in room.players) {
    // Create a shallow copy of player for current round
    room.currentRoundData.participants[playerId] = { ...room.players[playerId] };

    // Reset each player's answer status for the new round
    room.players[playerId].hasAnswered = false;
    room.players[playerId].hasVotedThisRound = false;
  }

  // Emit start challenge event to all clients
  io.to(room.code).emit('start_challenge', {
    prompt: room.currentRoundData.prompt,
    players: getFilteredPlayersForClient(room),
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
  });

  // Send event to hide start button / game controls
  io.to(room.code).emit('hide_game_controls');
}

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

      // Mark player as inactive instead of removing them
      if (room.players[socket.id]) {
        room.players[socket.id].isActive = false;
        console.log(
          `[ROOM] Player ${socket.id} (${room.players[socket.id].name}) marked as inactive in room ${room.code}`,
        );
      }

      // Leave socket.io room
      socket.leave(room.code);

      // Check if all players are inactive
      const allPlayersInactive = Object.values(room.players).every(
        (player) => player.isAI || player.isActive === false,
      );

      // If all players are inactive, remove the room
      if (allPlayersInactive && Object.keys(room.players).length > 0) {
        delete rooms[room.code];
        console.log(`[ROOM] Room ${room.code} removed because all players are inactive`);
        console.log(`[ROOMS] Total active rooms: ${Object.keys(rooms).length}`);
      } else {
        // Notify all clients in the room about player list update
        io.to(room.code).emit('update_players', getFilteredPlayersForClient(room));

        // If game was in progress, pause it (but don't end it)
        if (room.gameState !== 'waiting') {
          io.to(room.code).emit(
            'status_update',
            'Player disconnected. Waiting for reconnection...',
          );
        }
      }
    }
  });

  // Handle player manually leaving a room
  socket.on('leave_room', () => {
    // Find player's room
    const room = getRoomFromPlayerId(socket.id);
    if (!room) return;

    console.log(`[ROOM] Player ${socket.id} manually left room ${room.code}`);

    // Store player's name before removing them from the room
    const playerName = room.players[socket.id]?.name || 'A player';

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
      // Notify all remaining clients in the room about player list update
      io.to(room.code).emit('update_players', getFilteredPlayersForClient(room));

      // Send status update to remaining players
      io.to(room.code).emit('status_update', `${playerName} left the room.`);

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

    // Send confirmation to the client
    socket.emit('room_left');
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
      roundsHistory: [], // Initialize empty array to track round history
      playerVotesReceived: {},
      playerAIDetectionSuccess: {},
    };

    // Get a list of player names already used in this room (empty at this point, but using the same pattern)
    const usedNames: string[] = Object.values(rooms[roomCode].players).map((player) => player.name);
    // Assign a random name to the player that isn't already in use
    const randomName = getRandomPlayerName(usedNames);

    // Create new player
    const newPlayer = {
      id: socket.id,
      name: randomName,
      score: 0,
      isAI: false,
      isReady: false,
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
  socket.on('join_room', (data: string | { roomCode: string; playerName?: string }) => {
    // Handle both string (roomCode only) and object (with playerName) formats
    let roomCode: string;
    let requestedPlayerName: string | undefined;

    if (typeof data === 'string') {
      roomCode = data;
    } else {
      roomCode = data.roomCode;
      requestedPlayerName = data.playerName;
    }

    // Validate room code
    if (!rooms[roomCode]) {
      socket.emit('room_error', 'Room not found');
      return;
    }

    const room = rooms[roomCode];

    // Don't allow joining if game in progress and this is a new player (not reconnecting)
    if (room.gameState !== 'waiting' && !requestedPlayerName) {
      socket.emit('room_error', 'Game in progress, try again later');
      return;
    }

    let player: Player;
    let isReconnection = false;

    // Check if this is a reconnection attempt
    if (requestedPlayerName) {
      // Look for an inactive player with this name
      const inactivePlayer = Object.values(room.players).find(
        (p) => p.name === requestedPlayerName && p.isActive === false,
      );

      if (inactivePlayer) {
        // This is a reconnection - replace the player ID with the new socket ID
        const oldPlayerId = inactivePlayer.id;

        // Create a copy of the player with the new socket ID
        player = {
          ...inactivePlayer,
          id: socket.id,
          isActive: true,
        };

        // Remove the old player entry and add the new one
        delete room.players[oldPlayerId];
        room.players[socket.id] = player;

        // If there's an active round, update the participant list with the new socket ID
        if (room.gameState !== 'waiting' && room.currentRoundData.participants) {
          // Check if the old player ID is in the participants list
          if (room.currentRoundData.participants[oldPlayerId]) {
            // Copy the participant data to the new player ID
            room.currentRoundData.participants[socket.id] = {
              ...room.currentRoundData.participants[oldPlayerId],
              id: socket.id,
            };

            // Remove the old player ID from participants
            delete room.currentRoundData.participants[oldPlayerId];
          }

          // If there are answers, update those too
          if (room.currentRoundData.answers?.[oldPlayerId]) {
            room.currentRoundData.answers[socket.id] = {
              ...room.currentRoundData.answers[oldPlayerId],
              playerId: socket.id,
            };

            delete room.currentRoundData.answers[oldPlayerId];
          }

          // If there are votes, update those too
          if (room.currentRoundData.currentVotes) {
            // Update votes cast by this player
            if (room.currentRoundData.currentVotes[oldPlayerId]) {
              room.currentRoundData.currentVotes[socket.id] =
                room.currentRoundData.currentVotes[oldPlayerId];
              delete room.currentRoundData.currentVotes[oldPlayerId];
            }

            // Update votes for this player
            for (const voterId in room.currentRoundData.currentVotes) {
              if (room.currentRoundData.currentVotes[voterId] === oldPlayerId) {
                room.currentRoundData.currentVotes[voterId] = socket.id;
              }
            }
          }
        }

        // Mark as reconnection
        isReconnection = true;

        console.log(
          `[ROOM] Player ${requestedPlayerName} (${socket.id}) reconnected to room ${roomCode}`,
        );
      } else {
        // Check if the name is already taken by an active player
        const isNameTaken = Object.values(room.players).some(
          (p) => p.name === requestedPlayerName && p.isActive !== false,
        );

        if (isNameTaken) {
          // Can't use this name, it's taken by an active player
          // Assign a random name instead
          const usedNames: string[] = Object.values(room.players).map((p) => p.name);
          const randomName = getRandomPlayerName(usedNames);

          player = {
            id: socket.id,
            name: randomName,
            score: 0,
            isAI: false,
            isReady: false,
            roomCode,
            isActive: true,
          };

          console.log(
            `[ROOM] Player ${socket.id} couldn't reconnect as ${requestedPlayerName} (name taken), joined as ${randomName}`,
          );
        } else {
          // Name is available, create a new player with the requested name
          player = {
            id: socket.id,
            name: requestedPlayerName,
            score: 0,
            isAI: false,
            isReady: false,
            roomCode,
            isActive: true,
          };

          console.log(`[ROOM] Player ${socket.id} joined as ${requestedPlayerName}`);
        }
      }
    } else {
      // Standard join with random name
      const usedNames: string[] = Object.values(room.players).map((p) => p.name);
      const randomName = getRandomPlayerName(usedNames);

      player = {
        id: socket.id,
        name: randomName,
        score: 0,
        isAI: false,
        isReady: false,
        roomCode,
        isActive: true,
      };

      console.log(`[ROOM] Player ${socket.id} joined as ${randomName}`);
    }

    // Add player to room if not already done in reconnection
    if (!isReconnection) {
      room.players[socket.id] = player;
    }

    // Join socket.io room
    socket.join(roomCode);

    // Log player count
    console.log(`[ROOM] Room ${roomCode} now has ${Object.keys(room.players).length} players`);

    // Emit room joined event with a flag indicating if it's a reconnection
    socket.emit('room_joined', {
      roomCode,
      player,
      isReconnection,
    });

    // Notify room about player list update
    io.to(roomCode).emit('update_players', getFilteredPlayersForClient(room));

    // For reconnections during a game, need to catch them up
    if (isReconnection && room.gameState !== 'waiting') {
      // Send current game state to reconnected player
      socket.emit('status_update', 'Welcome back! Rejoining the game in progress...');

      // Always send vote statistics during reconnection to ensure UI correctly shows votes
      socket.emit('update_vote_statistics', {
        playerVotesReceived: room.playerVotesReceived,
      });

      // First, send the current round information to ensure UI displays correctly
      if (room.currentRound > 0 && room.totalRounds > 0) {
        socket.emit('rounds_set', room.totalRounds);
        socket.emit('disable_rounds_input', room.totalRounds);
      }

      // If in challenge phase, send the current prompt
      if (room.gameState === 'challenge' && room.currentRoundData.prompt) {
        socket.emit('start_challenge', {
          prompt: room.currentRoundData.prompt,
          currentRound: room.currentRound,
          totalRounds: room.totalRounds,
        });

        // Also send player update to ensure all players are visible
        socket.emit('update_players', getFilteredPlayersForClient(room));

        // If the player has already answered in this round, disable the answer input
        if (room.currentRoundData.answers[socket.id]) {
          socket.emit('status_update', 'You already submitted an answer. Waiting for others...');
        } else {
          // If they haven't answered yet, let them know they can still submit
          socket.emit('status_update', 'Answer the question when ready.');
        }
      }
      // If in results phase, send the current answers
      else if (room.gameState === 'results' && room.currentRoundData.answers) {
        // First send the challenge information to set up the UI
        socket.emit('start_challenge', {
          prompt: room.currentRoundData.prompt || 'Round in progress...',
          currentRound: room.currentRound,
          totalRounds: room.totalRounds,
        });

        // Collect answers to resend
        const formattedAnswers = Object.values(room.currentRoundData.participants).map(
          (participant) => {
            const answer = room.currentRoundData.answers[participant.id];
            return {
              name: participant.name,
              answer: answer ? answer.answer : '',
            };
          },
        );

        // Then send the answers that have been collected
        socket.emit('show_public_answers', formattedAnswers);

        // Update player list
        socket.emit('update_players', getFilteredPlayersForClient(room));
      }
      // If in voting phase, send voting data
      else if (room.gameState === 'voting') {
        // First send the challenge information to set up the UI
        socket.emit('start_challenge', {
          prompt: room.currentRoundData.prompt || 'Round in progress...',
          currentRound: room.currentRound,
          totalRounds: room.totalRounds,
        });

        // Then send answers
        const formattedAnswers = Object.values(room.currentRoundData.participants).map(
          (participant) => {
            const answer = room.currentRoundData.answers[participant.id];
            return {
              name: participant.name,
              answer: answer ? answer.answer : '',
            };
          },
        );
        socket.emit('show_public_answers', formattedAnswers);

        // Finally, start voting phase
        socket.emit('start_voting', {
          participants: room.currentRoundData.participants,
          aiPlayer: { id: room.aiPlayerId, name: room.currentAiPlayerName },
        });

        // If player has already voted, update status and send which player they voted for
        if (room.players[socket.id]?.hasVotedThisRound) {
          socket.emit('status_update', 'Vote cast! Waiting for results...');

          // If player has already voted, send their vote selection to restore UI state
          if (room.currentRoundData.currentVotes[socket.id]) {
            const votedPlayerId = room.currentRoundData.currentVotes[socket.id];
            socket.emit('restore_vote_selection', {
              votedPlayerId,
              playerName: room.players[votedPlayerId]?.name || '',
            });
          }
        }

        // Always send current vote statistics to ensure UI reflects votes
        socket.emit('update_vote_statistics', {
          playerVotesReceived: room.playerVotesReceived,
        });

        // Update player list
        socket.emit('update_players', getFilteredPlayersForClient(room));
      }
    }
    // Show configuration UI to the newly joined player if game hasn't started
    else if (room.gameState === 'waiting') {
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

  // Handle player ready status
  socket.on('player_ready', (readyStatus: boolean) => {
    // Find player's room
    const room = getRoomFromPlayerId(socket.id);
    if (!room) return;

    // Only update ready status if in waiting state
    if (room.gameState !== 'waiting') return;

    // Update player ready status
    if (room.players[socket.id]) {
      room.players[socket.id].isReady = readyStatus;

      // Notify all players about the updated ready status
      io.to(room.code).emit('update_players', getFilteredPlayersForClient(room));

      // For initial game start (first round), require all players to be ready
      // For subsequent rounds, any player can start the next round
      if (!room.isGameStarted) {
        // Initial game start - check if all players are ready
        const allPlayers = Object.values(room.players).filter((p) => !p.isAI);
        const allPlayersReady = allPlayers.length > 0 && allPlayers.every((p) => p.isReady);

        if (allPlayersReady) {
          startGame(room);
        }
      } else if (readyStatus) {
        // This is between rounds and this player is ready - start next round immediately
        startGame(room);
      }
    }
  });

  // Handle request to start a new round (admin override or direct start)
  socket.on('request_start_round', () => {
    // Find player's room
    const room = getRoomFromPlayerId(socket.id);
    if (!room) return;

    // Don't start a new round if one is already in progress
    if (room.gameState !== 'waiting') return;

    // For between-rounds, any player can start the next round
    // For first round (initial game start), still use the ready system
    if (room.isGameStarted) {
      // Between rounds - start immediately
      startGame(room);
    } else {
      // First game - mark this player as ready
      if (room.players[socket.id]) {
        room.players[socket.id].isReady = true;

        // Notify all players about the updated ready status
        io.to(room.code).emit('update_players', getFilteredPlayersForClient(room));

        // Check if all players are now ready
        const allPlayers = Object.values(room.players).filter((p) => !p.isAI);
        const allPlayersReady = allPlayers.length > 0 && allPlayers.every((p) => p.isReady);

        if (allPlayersReady) {
          startGame(room);
        }
      }
    }
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
    const answerData = {
      playerId: socket.id,
      answer: data.answer,
      timeSpent: data.timeSpent,
    };

    // Store in current round data
    room.currentRoundData.answers[socket.id] = answerData;

    // Also store in round history
    const currentRoundHistory = room.roundsHistory.find((h) => h.roundNumber === room.currentRound);
    if (currentRoundHistory) {
      currentRoundHistory.answers[socket.id] = answerData;
    }

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
      console.log(`[ROOM] All humans answered in room ${room.code}, generating AI answer now`);

      // Generate and immediately submit AI answer now that we have all human answers
      generateAndSubmitAIAnswer(room, room.currentRoundData.prompt)
        .then(() => {
          // Save AI answer to history as well
          const currentRoundHistory = room.roundsHistory.find(
            (h) => h.roundNumber === room.currentRound,
          );
          if (currentRoundHistory && room.currentRoundData.answers[room.aiPlayerId]) {
            currentRoundHistory.answers[room.aiPlayerId] =
              room.currentRoundData.answers[room.aiPlayerId];
          }

          // End challenge phase once AI has answered
          endChallengePhase(room);
        })
        .catch((error) => {
          console.error('Error generating AI answer after all humans answered:', error);
          // Provide fallback answer
          if (room.gameState === 'challenge') {
            const fallbackAnswer = {
              playerId: room.aiPlayerId,
              answer: 'Sorry, I was distracted. What was the question again?',
              timeSpent: 1000, // Very short time since we're answering immediately
            };

            // Store in current round data
            room.currentRoundData.answers[room.aiPlayerId] = fallbackAnswer;

            // Also store in round history
            const currentRoundHistory = room.roundsHistory.find(
              (h) => h.roundNumber === room.currentRound,
            );
            if (currentRoundHistory) {
              currentRoundHistory.answers[room.aiPlayerId] = fallbackAnswer;
            }

            // Mark AI as having answered
            if (room.currentRoundData.participants[room.aiPlayerId]) {
              room.currentRoundData.participants[room.aiPlayerId].hasAnswered = true;
            }

            // Add a short delay before ending the challenge phase
            // This allows time for any client-side auto-submissions to arrive
            setTimeout(() => {
              endChallengePhase(room);
            }, 500); // 500ms delay to collect all partial answers
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

  // Game configuration handlers

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

    for (const playerId in room.currentRoundData.answers) {
      if (playerId === room.aiPlayerId) continue;

      const answer = room.currentRoundData.answers[playerId].answer;
      humanAnswers.push(answer);
      totalAnswerCount++;
      totalAnswerLength += answer.length;
    }

    if (!useCurrentRoundAnswersOnly) {
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
    }

    // Calculate average answer length to help the AI match
    const avgAnswerLength =
      totalAnswerCount > 0 ? Math.floor(totalAnswerLength / totalAnswerCount) : 50;

    // Analyze casing style of human answers
    const casingStyleEnum = analyzeCasingFromHumanAnswers(humanAnswers);
    const casingStyle = casingStyleToString(casingStyleEnum);

    // Base imposter behavior - aligned with combineImposterPrompts function's basePrompt
    const baseImposterBehavior = `
    Keep your answer very short (between 2-10 words).
    Be concise and direct. Remember that humans only have about 45 seconds to read and answer each question.`;

    // Build prompt with current context
    let answerPrompt = `
    You are participating in a social deduction game where humans try to guess which participant is an AI.
    Your task is to write a convincing human-like answer to this prompt: "${gamePrompt}"
    
    Write a response that is believable as a human response. Do not be too verbose or technical.
    Use casual language, and possibly include minor grammatical errors or slang occasionally, but don't overdo it.
    ${baseImposterBehavior}
    `;

    // Include length guidance based on actual answers
    answerPrompt += `\nMake your answer roughly around ${avgAnswerLength} characters long to imitate other humans. This will help you blend in with the human responses.`;

    // Include casing style guidance
    answerPrompt += `\nUse ${casingStyle} in your answer to match the style of the average human players.`;

    console.log(`[PRE_GEN] average answer length: ${avgAnswerLength}`);
    console.log(`[PRE_GEN] casing style: ${casingStyle}`);
    console.log(`[PRE_GEN] total human answers count: ${totalAnswerCount}`);
    console.log(`[PRE_GEN] total human answer length: ${totalAnswerLength}`);
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
    console.log(
      `[LLM_CALL] AI Player Answer Generator - room ${room.code} - ${immediateResponse ? 'immediate' : 'scheduled'}`,
    );
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
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

// generateAIAnswer function removed - AI answers are now only generated when all humans have answered

function endChallengePhase(room: Room): void {
  // Don't end if not in challenge phase
  if (room.gameState !== 'challenge') return;

  // Only include answers from players who have submitted them
  // No auto-creation of placeholder answers

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

type PublicAnswerData = {
  id: string;
  name: string;
  answer: string | null;
  time: number | null;
};

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

function startVotingPhase(room: Room): void {
  // Set game state to voting
  room.gameState = 'voting';

  // Clear previous votes
  room.currentRoundData.currentVotes = {};

  // Reset voting flags for all players
  for (const player of Object.values(room.players)) {
    player.hasVotedThisRound = false;
  }

  // Emit start_voting event to all clients in this room
  io.to(room.code).emit('start_voting', {
    participants: room.currentRoundData.participants,
    aiPlayer: { id: room.aiPlayerId, name: room.currentAiPlayerName },
  });

  // AI will vote when last human votes
  // Voting phase ends when all players have voted
}

// AI voting functionality removed as AI votes are not counted

function endVotingPhase(room: Room): void {
  // Don't end if not in voting phase
  if (room.gameState !== 'voting') return;

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

    // Add deception points to final scores on the last round
    // This ensures votes received across all rounds are added to the total score
    for (const playerId in room.playerVotesReceived) {
      // Skip AI player - AI doesn't get deception points
      if (playerId === room.aiPlayerId) continue;

      // Add 1 point per vote received
      if (room.players[playerId]) {
        const votesReceived = room.playerVotesReceived[playerId] || 0;
        room.players[playerId].score += votesReceived;
        console.log(`[SCORE] Adding ${votesReceived} deception points to player ${playerId}`);
      }
    }
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
      // Add round history with prompts and answers
      roundsHistory: room.roundsHistory,
      // Include votes across all rounds
      allRoundsVotes: room.allRoundsVotes,
    });

    // Reset gameStarted flag to allow name randomization in the next game
    room.isGameStarted = false;
  }
}

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
