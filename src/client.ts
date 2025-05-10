// Client-side game logic

// Define types
interface Player {
  id: string;
  name: string;
  score: number;
  isAI?: boolean;
  answer?: string;
  time?: number;
  roomCode?: string;
}

interface PublicAnswer {
  name: string;
  answer: string;
  time?: number;
}

interface VoteData {
  participants: Record<string, Player>;
  aiPlayer: Player;
  duration?: number; // Duration for voting in milliseconds
}

interface VoteResults {
  players: Record<string, Player>;
  winners: string[];
  message: string;
  aiPlayer: Player;
  allRoundsVotes?: Array<{
    roundNumber: number;
    votes: Record<string, string>; // voterId -> votedForId
  }>;
  currentRound?: number;
  totalRounds?: number;
  isLastRound?: boolean;
  revealAI?: boolean;
  playerVotesReceived?: Record<string, number>; // playerId -> number of votes received
  playerAIDetectionSuccess?: Record<string, number>; // playerId -> number of correct AI detections
  combinedImposterPrompt?: string; // The combined imposter prompt used for the AI
  playerImposterPrompts?: Record<string, string>; // Individual player imposter prompts
  currentPrompt?: string; // The prompt that was used in the round
  questionPromptCount?: number; // How many question generation prompts were submitted
  combinedQuestionPrompt?: string; // The combined prompt used for question generation
  playerQuestionPrompts?: Record<string, string>; // Individual player question prompts
}

interface RoomData {
  roomCode: string;
  player: Player;
}

interface GameComplete {
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
    answers: Record<
      string,
      {
        playerId: string;
        answer: string;
        timeSpent: number;
      }
    >;
  }>;
}

// Define socket type
type SocketCallback<T = unknown> = (data: T) => void;
type Socket = {
  id: string;
  on: <T>(event: string, callback: SocketCallback<T>) => void;
  emit: (event: string, ...args: unknown[]) => void;
};

// Socket.io connection
let socket: Socket;
let myPlayerId = '';
let myRoomCode = ''; // Will store the current room code
let roundEndTime = 0;
let timerInterval: number | null = null;
let playerVotesReceived: Record<string, number> = {}; // Track votes received by each player
const currentPlayers: Record<string, Player> = {}; // Store current players to look up player IDs

// Track player colors for the current room
const playerColors: Record<string, string> = {};

// We're no longer using Tailwind colors, but keeping this for reference
// Commented out to avoid linting errors
/*
const availableColors = [
  'bg-red-500',
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-purple-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-lime-500',
  'bg-indigo-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-teal-500',
  'bg-rose-500',
  'bg-fuchsia-500',
];
*/

// We're now using direct color values, but keeping this for reference
// Commented out to avoid linting errors
/*
const colorMap: Record<string, string> = {
  'bg-purple-500': '#8b5cf6',
  'bg-blue-500': '#3b82f6',
  'bg-green-500': '#10b981',
  'bg-yellow-500': '#eab308',
  'bg-pink-500': '#ec4899',
  'bg-indigo-500': '#6366f1',
  'bg-red-500': '#ef4444',
  'bg-orange-500': '#f97316',
  'bg-cyan-500': '#06b6d4',
  'bg-emerald-500': '#10b981',
  'bg-violet-500': '#8b5cf6',
  'bg-rose-500': '#f43f5e',
  'bg-lime-500': '#84cc16',
  'bg-amber-500': '#f59e0b',
  'bg-teal-500': '#14b8a6',
  'bg-fuchsia-500': '#d946ef',
};
*/

// Track used colors in the current room to ensure diversity
const usedColorIndexes: number[] = [];

// Get a deterministic but random-looking color index for a player in the current room
function getPlayerIndex(playerId: string): number {
  // If we already assigned a color to this player, return it
  if (playerColors[playerId]) {
    // Parse the color hex to its index in the rawColors array
    const colorHex = playerColors[playerId];
    const existingIndex = rawColors.indexOf(colorHex);
    if (existingIndex !== -1) {
      console.log(
        `[COLOR_DEBUG] Using existing color ${colorHex} (index ${existingIndex}) for player ${playerId}`,
      );
      return existingIndex;
    }
  }

  // Calculate a hash from the player ID
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash << 5) - hash + playerId.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }

  // Get a positive value
  hash = Math.abs(hash);

  // Find an unused color index if possible
  if (usedColorIndexes.length < rawColors.length) {
    // Start at a position determined by the hash
    const startPosition = hash % rawColors.length;

    // Try each color index in sequence until we find an unused one
    for (let i = 0; i < rawColors.length; i++) {
      const tryIndex = (startPosition + i) % rawColors.length;
      if (!usedColorIndexes.includes(tryIndex)) {
        usedColorIndexes.push(tryIndex);
        // Store the assigned color
        playerColors[playerId] = rawColors[tryIndex];
        console.log(`[COLOR_DEBUG] Assigned new color index ${tryIndex} to player ${playerId}`);
        return tryIndex;
      }
    }
  }

  // If all colors are used, fall back to a hash-based assignment
  const fallbackIndex = hash % rawColors.length;
  playerColors[playerId] = rawColors[fallbackIndex];
  console.log(
    `[COLOR_DEBUG] All colors used, falling back to index ${fallbackIndex} for player ${playerId}`,
  );
  return fallbackIndex;
}

// This function is no longer used since we directly use getPlayerIndex and rawColors in renderPlayerList

// Declare io to avoid TypeScript error
declare const io: () => Socket;

// Connect to server when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Initialize socket connection
  socket = io();

  // Handle connection event
  socket.on('connect', () => {
    console.log('Connected to server');
    myPlayerId = socket.id;
  });

  // Room selection is now shown by default on page load, so this just updates the message
  socket.on('show_room_selection', () => {
    // Update status message
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = 'Create a new room or join an existing one!';
    }
  });

  // Function to reset color assignments when joining a new room
  function resetColorAssignments(): void {
    // Clear the player colors dictionary
    for (const key of Object.keys(playerColors)) {
      delete playerColors[key];
    }

    // Reset the used color indexes array
    usedColorIndexes.length = 0;

    console.log('[COLOR_DEBUG] Color assignments reset completely');
  }

  // Handle room created event
  socket.on('room_created', (data: RoomData) => {
    // Reset color assignments for the new room
    resetColorAssignments();

    handleRoomJoined(data);

    // Show success message
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = 'Room created! Waiting for players to join...';
    }
  });

  // Handle room joined event
  socket.on('room_joined', (data: RoomData) => {
    // Reset color assignments for the new room
    resetColorAssignments();

    handleRoomJoined(data);

    // Show success message
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = 'Room joined! Waiting for the game to start...';
    }
  });

  // Handle room error event
  socket.on('room_error', (errorMessage: string) => {
    // Show error message
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = `Error: ${errorMessage}`;
      statusMessage.classList.remove('bg-blue-500');
      statusMessage.classList.add('bg-red-500');

      // Reset back to blue after 3 seconds
      setTimeout(() => {
        statusMessage.classList.remove('bg-red-500');
        statusMessage.classList.add('bg-blue-500');
      }, 3000);
    }
  });

  // Handle player list updates
  socket.on('update_players', (serverPlayers: Record<string, Player>) => {
    console.log('[COLOR_DEBUG] update_players event received, rendering player list');

    // Store the current players list to use for answer-to-player mapping
    Object.assign(currentPlayers, serverPlayers);

    renderPlayerList(serverPlayers);

    // Check player colors after rendering
    setTimeout(checkPlayerAvatarColors, 100);

    // Update player count if in a room
    if (myRoomCode) {
      updatePlayerCount(Object.keys(serverPlayers).length);
    }
  });

  // Handle showing UI configuration to all players
  socket.on('show_config_ui', (data: { isFirstGame: boolean }) => {
    const startButton = document.getElementById('start-round-button') as HTMLButtonElement;
    const roundConfig = document.getElementById('round-config');

    if (startButton && roundConfig) {
      // Set the appropriate button text based on the game state
      if (data?.isFirstGame) {
        startButton.textContent = 'Start Game';
        // Show round configuration at the start of the game
        roundConfig.classList.remove('hidden');
      } else {
        startButton.textContent = 'Next Round';
        // Hide round configuration for subsequent rounds
        roundConfig.classList.add('hidden');
      }

      // Show the button (initially disabled until enable_start_button event)
      startButton.classList.remove('hidden');
      startButton.disabled = true;
      startButton.classList.add('opacity-50');
    }
  });

  // Enable the start button for players
  socket.on('enable_start_button', () => {
    const startButton = document.getElementById('start-round-button') as HTMLButtonElement;
    if (startButton) {
      startButton.disabled = false;
      startButton.classList.remove('opacity-50');
    }
  });

  /**
   * Helper function to start or reset a round timer
   * @param duration Duration in milliseconds
   * @param message Status message to show
   */
  function startTimer(duration: number, message: string): void {
    // Update status message
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = message;
    }

    // Set up and display timer
    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay) {
      timerDisplay.classList.remove('hidden');
      // Reset to normal state
      timerDisplay.classList.remove('timer-warning', 'timer-danger');
      timerDisplay.classList.add('timer-normal');
    }

    // Set timer end time
    roundEndTime = Date.now() + duration;

    // Clear any existing interval
    if (timerInterval) {
      clearInterval(timerInterval);
    }

    // Start new timer interval
    timerInterval = setInterval(updateTimerDisplay, 1000) as unknown as number;
    updateTimerDisplay(); // Call immediately to show timer

    // Also set a hard timeout as a fallback to ensure answers are submitted
    if (roundEndTime > 0) {
      // Set a direct timeout that will trigger submission when time is up
      // This is a failsafe in addition to the interval-based timer
      const timeoutDuration = roundEndTime - Date.now();
      console.log(`Setting direct timer expiration in ${timeoutDuration}ms`);
      setTimeout(() => {
        console.log('Direct timer expiration triggered');
        const answerInput = document.getElementById('answer-input') as HTMLTextAreaElement;
        if (answerInput && !answerInput.classList.contains('hidden') && !answerInput.disabled) {
          console.log('Auto-submitting answer from direct timeout');
          // Directly submit whatever is in the answer box
          socket.emit('submit_answer', {
            answer: answerInput.value.trim(),
            timeSpent: 0, // Time's up
          });

          // Disable input
          answerInput.disabled = true;

          // Hide submit button if it exists
          const submitButton = document.getElementById('submit-answer-button') as HTMLButtonElement;
          if (submitButton) {
            submitButton.classList.add('hidden');
          }

          // Update status
          const statusMessage = document.getElementById('status-message');
          if (statusMessage) {
            statusMessage.textContent = "Time's up! Your answer has been submitted.";
          }
        }
      }, timeoutDuration);
    }
  }

  // Handle start challenge event
  socket.on(
    'start_challenge',
    (data: { prompt: string; duration: number; currentRound?: number; totalRounds?: number }) => {
      // Show answer area and switch to game layout
      const gameGrid = document.getElementById('game-grid');
      const answerArea = document.getElementById('answer-area');

      if (gameGrid) {
        // Remove waiting-state class to show the normal game grid layout
        gameGrid.classList.remove('waiting-state');
      }

      if (answerArea) {
        // Show the answer area now that the game is starting
        answerArea.classList.remove('hidden');
      }

      // Display the prompt
      const promptArea = document.getElementById('prompt-area');
      if (promptArea) {
        // Update the round info in the room info area
        if (data.currentRound && data.totalRounds) {
          // Look for existing rounds info or create it
          const roomInfoArea = document.getElementById('room-info-area');
          if (roomInfoArea) {
            let roundsInfo = document.getElementById('rounds-info');
            if (!roundsInfo) {
              // Create the rounds info element if it doesn't exist
              roundsInfo = document.createElement('div');
              roundsInfo.id = 'rounds-info';
              roundsInfo.className = 'rounds-counter';
              const flexContainer = roomInfoArea.querySelector('.flex');
              if (flexContainer) {
                flexContainer.appendChild(roundsInfo);
              }
            }
            // Update the rounds info to show current round
            roundsInfo.textContent = `Round ${data.currentRound} of ${data.totalRounds}`;
            roundsInfo.className = 'rounds-counter';
          }
        }

        // Display just the prompt without round number
        promptArea.textContent = data.prompt;

        // Show player list header elements
        const playerTitle = document.querySelector('#player-list-container h2');
        const votesReceivedLabel = document.querySelector('#player-list-container .text-gray-500');

        if (playerTitle) {
          playerTitle.classList.remove('hidden');
          playerTitle.textContent = 'Players';
        }

        if (votesReceivedLabel) {
          votesReceivedLabel.classList.remove('hidden');
        }

        // Force player list refresh to show all players now that game has started
        socket.emit('request_players_update');
      }

      // Show and enable the input and submit button
      const answerInput = document.getElementById('answer-input') as HTMLTextAreaElement;
      const submitButton = document.getElementById('submit-answer-button') as HTMLButtonElement;

      if (answerInput && submitButton) {
        answerInput.classList.remove('hidden');
        answerInput.value = '';
        answerInput.disabled = false;

        submitButton.classList.remove('hidden');
        submitButton.disabled = false;
      }

      // Clear previous results
      clearElementContent('public-answers-area');
      clearElementContent('voting-area');

      // Start the timer for the challenge phase
      startTimer(data.duration, 'Answer the question before time runs out!');
    },
  );

  // Handle status update event
  socket.on('status_update', (message: string) => {
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = message;
    }
  });

  // Handle public answers event
  socket.on('show_public_answers', (publicAnswers: PublicAnswer[]) => {
    // Hide timer display
    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay) {
      timerDisplay.classList.add('hidden');
    }

    // Clear timer interval if active
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = 'Review all answers. Who do you think is the AI?';
    }

    // Display all answers
    const answersArea = document.getElementById('public-answers-area');
    if (answersArea) {
      answersArea.innerHTML = '<h3 class="text-lg font-semibold mb-3">All Answers:</h3>';

      // Display the answers in the order provided by the server
      // (randomly shuffled by the server)
      for (let i = 0; i < publicAnswers.length; i++) {
        const answer = publicAnswers[i];

        // Always show the answer card, even if the answer is empty
        const answerCard = document.createElement('div');
        answerCard.className = 'answer-card vote-enabled';

        // Hide player names during voting phase, show only the answer
        answerCard.innerHTML = `
          <div class="mb-1"><span class="font-semibold answer-player-name" data-player-name="${answer.name}"></span></div>
          <div>${answer.answer || '<em class="text-gray-400">No answer provided</em>'}</div>
        `;

        // Store the player name as data attribute for later
        answerCard.dataset.playerName = answer.name;

        // Add voting click handler
        answerCard.addEventListener('click', () => {
          // Find which player ID this answer belongs to
          const playerName = answerCard.dataset.playerName;
          const playerEntry = Object.entries(currentPlayers).find(
            ([, player]) => player.name === playerName,
          );

          if (playerEntry && playerEntry[0] !== myPlayerId) {
            // Cast vote for this player
            castVote(playerEntry[0]);

            // Add visual indication that this answer was voted for
            const allAnswerCards = document.querySelectorAll('.answer-card');
            for (const card of Array.from(allAnswerCards)) {
              card.classList.remove('selected-answer');
              card.classList.remove('vote-enabled');
            }

            answerCard.classList.add('selected-answer');

            // Update status
            const statusMsg = document.getElementById('status-message');
            if (statusMsg) {
              statusMsg.textContent = 'Vote cast! Waiting for results...';
            }
          } else if (playerEntry && playerEntry[0] === myPlayerId) {
            // Can't vote for yourself
            answerCard.classList.add('cannot-vote');
            setTimeout(() => {
              answerCard.classList.remove('cannot-vote');
            }, 1000);
          }
        });

        // Add hover styling for clickable answers
        answerCard.style.cursor = 'pointer';
        answerCard.style.transition = 'background-color 0.2s';

        answersArea.appendChild(answerCard);
      }

      // Add some basic styling for interactivity
      const style = document.createElement('style');
      style.innerHTML = `
        .vote-enabled:hover {
          background-color: #f0f9ff !important;
          border-color: #3b82f6 !important;
        }
        .selected-answer {
          background-color: #dbeafe !important;
          border-color: #2563eb !important;
          border-width: 2px !important;
        }
        .cannot-vote {
          background-color: #fee2e2 !important;
          border-color: #ef4444 !important;
          transition: background-color 0.2s, border-color 0.2s;
        }
      `;
      document.head.appendChild(style);
    }
  });

  // Handle start voting event
  socket.on('start_voting', (data: VoteData) => {
    const { duration = 30000 } = data;

    // Store participants for looking up player IDs
    Object.assign(currentPlayers, data.participants);

    // Start the timer for the voting phase
    startTimer(duration, 'Click on an answer to vote for who you think is the AI!');

    // We now vote by clicking on answers, so we don't need to show the voting area
    // but we keep the element around for timer expiration logic
    const votingArea = document.getElementById('voting-area');
    if (votingArea) {
      votingArea.innerHTML = ''; // Clear it but don't show it
      votingArea.classList.add('hidden');
    }

    // Add a hint at the top of the public answers area to make it clear how to vote
    const answersArea = document.getElementById('public-answers-area');
    if (answersArea?.firstChild) {
      const votingHint = document.createElement('div');
      votingHint.className = 'voting-hint mb-4 p-3 bg-blue-50 rounded-lg text-center';
      votingHint.innerHTML =
        '<p class="font-semibold">Click on an answer to vote for who you think is the AI</p>';
      answersArea.insertBefore(votingHint, answersArea.firstChild.nextSibling);
    }

    // Add visual cues to answer cards and label only your own answer
    const answerCards = document.querySelectorAll('.answer-card');
    for (const card of Array.from(answerCards)) {
      const playerName = (card as HTMLElement).dataset.playerName;
      const playerEntry = Object.entries(currentPlayers).find(
        ([, player]) => player.name === playerName,
      );

      if (playerEntry && playerEntry[0] === myPlayerId) {
        // This is the current player's answer - label it and make it not clickable
        const nameElement = card.querySelector('.answer-player-name');
        if (nameElement) {
          nameElement.textContent = 'Your answer';
          nameElement.className = 'font-semibold answer-player-name text-blue-600';
        }
        card.classList.remove('vote-enabled');
        (card as HTMLElement).style.cursor = 'default';
        card.classList.add('my-answer');
      } else if (!card.classList.contains('vote-enabled')) {
        // Make other answers clickable
        card.classList.add('vote-enabled');
      }
    }
  });

  // Handle vote results event
  socket.on('show_vote_results', (data: VoteResults) => {
    // Ensure timer display is hidden
    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay) {
      timerDisplay.classList.add('hidden');
    }

    // Make sure timer interval is cleared
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    // Extract relevant data
    const {
      players,
      message,
      aiPlayer,
      revealAI = false,
      isLastRound = false,
      currentRound,
      totalRounds,
      playerVotesReceived: votesReceived,
      playerAIDetectionSuccess,
      questionPromptCount,
    } = data;

    // Update global player votes received if available
    if (votesReceived) {
      playerVotesReceived = votesReceived;
    }

    // Update status with result message
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      // Only show the message as-is if it's the last round
      // Otherwise, keep it generic to avoid revealing AI identity
      if (isLastRound) {
        statusMessage.textContent = message;
      } else {
        // Use a generic message that doesn't indicate if the AI was detected
        statusMessage.textContent = `Round ${currentRound} of ${totalRounds} complete!`;
      }
    }

    // Hide game elements
    const votingArea = document.getElementById('voting-area');

    if (votingArea) {
      votingArea.classList.add('hidden');
    }

    // Update player list with new scores
    renderPlayerList(players);

    // Mark the AI player in the answers area and reveal all player names
    const answersArea = document.getElementById('public-answers-area');
    if (answersArea) {
      // Remove the voting hint if it exists
      const votingHint = answersArea.querySelector('.voting-hint');
      if (votingHint) {
        votingHint.remove();
      }

      // Reveal all player names by replacing "Player X" with actual names
      const answerCards = Array.from(answersArea.querySelectorAll('.answer-card'));

      for (const card of answerCards) {
        // Get the player name from the data attribute
        const playerNameElement = card.querySelector('.answer-player-name');
        const playerName = playerNameElement?.getAttribute('data-player-name');

        if (playerNameElement && playerName) {
          // Replace "Player X" with actual name
          playerNameElement.textContent = playerName;

          // Mark AI player if we're revealing the AI
          if (revealAI && playerName === aiPlayer.name) {
            card.classList.add('answer-card-ai');
            card.innerHTML += `<div class="mt-2 italic text-red-600">(This was the AI)</div>`;
          }

          // Remove clickability
          card.classList.remove('vote-enabled');
          (card as HTMLElement).style.cursor = 'default';
        }
      }

      // Show AI detection stats if this is the last round
      if (isLastRound && playerAIDetectionSuccess) {
        // Create a stats area for final results
        const statsArea = document.createElement('div');
        statsArea.className = 'stats-area';
        statsArea.innerHTML = '<h3 class="text-lg font-semibold mb-2">🏆 Final Results 🏆</h3>';

        // Show detection stats
        const statsList = document.createElement('ul');
        statsList.className = 'list-disc pl-5';

        // Add AI reveal
        const aiReveal = document.createElement('p');
        aiReveal.className = 'font-bold text-red-600 mb-2';
        aiReveal.textContent = `The AI was: ${aiPlayer.name}`;
        statsArea.appendChild(aiReveal);

        // Show the AI imposter instructions section if available
        if (data.combinedImposterPrompt || data.playerImposterPrompts) {
          const promptInfo = document.createElement('div');
          promptInfo.className = 'mt-2 mb-3 p-3 bg-white rounded-lg border border-gray-200';

          const promptTitle = document.createElement('p');
          promptTitle.className = 'font-semibold text-sm text-gray-700 mb-1';
          promptTitle.textContent = 'The AI imposter was instructed to:';

          // Don't show combined prompt, just append the title
          promptInfo.appendChild(promptTitle);

          // Add individual player contributions
          if (data.playerImposterPrompts && Object.keys(data.playerImposterPrompts).length > 0) {
            const instructionsList = document.createElement('ul');
            instructionsList.className = 'mt-1 pl-5 text-sm';

            // Sort by player names for consistent display
            const sortedEntries = Object.entries(data.playerImposterPrompts)
              .map(([playerId, prompt]) => ({
                playerName: players[playerId]?.name || 'Unknown Player',
                prompt,
              }))
              .sort((a, b) => a.playerName.localeCompare(b.playerName));

            for (const { playerName, prompt } of sortedEntries) {
              const item = document.createElement('li');
              item.className = 'mb-1';

              const playerSpan = document.createElement('span');
              playerSpan.className = 'font-semibold';
              playerSpan.textContent = `${playerName}: `;

              const promptSpan = document.createElement('span');
              promptSpan.className = 'italic';
              promptSpan.textContent = prompt;

              item.appendChild(playerSpan);
              item.appendChild(promptSpan);
              instructionsList.appendChild(item);
            }

            promptInfo.appendChild(instructionsList);
          }

          statsArea.appendChild(promptInfo);
        }

        // Show question generation info if prompts were submitted
        if (questionPromptCount && questionPromptCount > 0) {
          const questionInfo = document.createElement('div');
          questionInfo.className = 'mt-2 mb-3 p-3 bg-white rounded-lg border border-gray-200';

          const questionTitle = document.createElement('p');
          questionTitle.className = 'font-semibold text-sm text-gray-700 mb-1';
          questionTitle.textContent = 'Question Generation:';

          const questionContent = document.createElement('p');
          questionContent.className = 'text-sm text-gray-600';
          questionContent.textContent = `${questionPromptCount} ${
            questionPromptCount === 1 ? 'player' : 'players'
          } contributed to generating AI questions.`;

          questionInfo.appendChild(questionTitle);
          questionInfo.appendChild(questionContent);

          // Don't show combined question prompt

          // Add individual player contributions
          if (data.playerQuestionPrompts && Object.keys(data.playerQuestionPrompts).length > 0) {
            const questionsList = document.createElement('ul');
            questionsList.className = 'mt-1 pl-5 text-sm';

            // Sort by player names for consistent display
            const sortedEntries = Object.entries(data.playerQuestionPrompts)
              .map(([playerId, prompt]) => ({
                playerName: players[playerId]?.name || 'Unknown Player',
                prompt,
              }))
              .sort((a, b) => a.playerName.localeCompare(b.playerName));

            for (const { playerName, prompt } of sortedEntries) {
              const item = document.createElement('li');
              item.className = 'mb-1';

              const playerSpan = document.createElement('span');
              playerSpan.className = 'font-semibold';
              playerSpan.textContent = `${playerName}: `;

              const promptSpan = document.createElement('span');
              promptSpan.className = 'italic';
              promptSpan.textContent = prompt;

              item.appendChild(playerSpan);
              item.appendChild(promptSpan);
              questionsList.appendChild(item);
            }

            questionInfo.appendChild(questionsList);
          }

          statsArea.appendChild(questionInfo);
        }

        // Add scoring breakdown title and explanation
        const scoringTitle = document.createElement('h4');
        scoringTitle.className = 'font-semibold mt-4 mb-2';
        scoringTitle.textContent = 'Player Scoring Breakdown:';
        statsArea.appendChild(scoringTitle);

        // Add scoring explanation
        const scoringExplanation = document.createElement('div');
        scoringExplanation.className = 'mb-3 text-sm text-gray-600';
        scoringExplanation.innerHTML = `
          <p>• <strong>Detection Points:</strong> +2 points each time you correctly identified the AI</p>
          <p>• <strong>Deception Points:</strong> Human players get +1 point for each vote received (including votes from the AI)</p>
          <p>• <strong>AI Points:</strong> The AI gets +1 point for surviving each round without being detected (but doesn't get deception points)</p>
        `;
        statsArea.appendChild(scoringExplanation);

        // Create table for scoring breakdown
        const scoreTable = document.createElement('div');
        scoreTable.className = 'w-full mb-4 overflow-hidden rounded-lg border border-gray-200';

        // Table header
        const tableHeader = document.createElement('div');
        tableHeader.className =
          'bg-gray-100 border-b border-gray-200 grid grid-cols-5 gap-1 p-2 font-semibold text-sm';
        tableHeader.innerHTML = `
          <div>Rank</div>
          <div>Player</div>
          <div>Detection Points</div>
          <div>Deception Points</div>
          <div>Total Score</div>
        `;
        scoreTable.appendChild(tableHeader);

        // Sort players by score in descending order
        const sortedPlayers = Object.entries(players)
          .filter(([id]) => id !== aiPlayer.id) // Filter out AI player
          .sort(([, playerA], [, playerB]) => playerB.score - playerA.score);

        // Table rows - one for each player with ranking
        sortedPlayers.forEach(([playerId, player], index) => {
          // Calculate scores
          const detectionPoints = (playerAIDetectionSuccess[playerId] || 0) * 2; // 2 points per correct detection
          const votesReceived = playerVotesReceived[playerId] || 0;
          const totalScore = player.score;

          // Create rank indicator with medal for top 3
          let rankDisplay = '';
          if (index === 0) {
            rankDisplay = '🥇 1st';
          } else if (index === 1) {
            rankDisplay = '🥈 2nd';
          } else if (index === 2) {
            rankDisplay = '🥉 3rd';
          } else {
            rankDisplay = `${index + 1}th`;
          }

          // Create row
          const playerRow = document.createElement('div');
          playerRow.className = 'grid grid-cols-5 gap-1 p-2 border-b border-gray-200 text-sm';

          // Highlight current player
          if (playerId === myPlayerId) {
            playerRow.classList.add('font-bold', 'bg-blue-100');
          }

          // Highlight winners
          if (index === 0) {
            playerRow.classList.add('bg-yellow-50');
          }

          playerRow.innerHTML = `
            <div class="font-semibold">${rankDisplay}</div>
            <div>${player.name}${playerId === myPlayerId ? ' <span class="text-blue-600">(you)</span>' : ''}</div>
            <div>${detectionPoints} <span class="text-xs text-gray-500">(${
              playerAIDetectionSuccess[playerId] || 0
            } × 2pts)</span></div>
            <div>${votesReceived} <span class="text-xs text-gray-500">(votes received × 1pt)</span></div>
            <div class="font-semibold">${totalScore}</div>
          `;

          scoreTable.appendChild(playerRow);
        });

        statsArea.appendChild(scoreTable);

        // Show each player's AI detection success details
        const detectionTitle = document.createElement('h4');
        detectionTitle.className = 'font-semibold mt-4 mb-2';
        detectionTitle.textContent = 'AI Detection Details:';
        statsArea.appendChild(detectionTitle);

        statsArea.appendChild(statsList);

        for (const [playerId, successes] of Object.entries(playerAIDetectionSuccess)) {
          // Skip AI player
          if (playerId === aiPlayer.id) continue;

          const playerName = players[playerId]?.name || 'Unknown Player';
          const successRate = totalRounds ? ((successes / totalRounds) * 100).toFixed(0) : 0;

          const statItem = document.createElement('li');
          statItem.textContent = `${playerName}: Detected AI correctly ${successes} out of ${totalRounds} times (${successRate}%)`;
          statsList.appendChild(statItem);
        }

        answersArea.appendChild(statsArea);
      }
    } else if (answersArea && currentRound && totalRounds) {
      // Update the round info in the room info area
      const roomInfoArea = document.getElementById('room-info-area');
      if (roomInfoArea) {
        let roundsInfo = document.getElementById('rounds-info');
        if (!roundsInfo) {
          // Create the rounds info element if it doesn't exist
          roundsInfo = document.createElement('div');
          roundsInfo.id = 'rounds-info';
          roundsInfo.className = 'rounds-counter';
          const flexContainer = roomInfoArea.querySelector('.flex');
          if (flexContainer) {
            flexContainer.appendChild(roundsInfo);
          }
        }

        if (isLastRound) {
          // Show completed status for last round
          roundsInfo.textContent = `All ${totalRounds} rounds completed`;
          roundsInfo.className = 'rounds-counter';
        } else {
          // Show completed status for current round
          roundsInfo.textContent = `Round ${currentRound} of ${totalRounds} completed`;
        }
      }

      // Also show a message in the answers area
      if (!isLastRound) {
        // We already checked that answersArea exists above
        const waitingMessage = document.createElement('div');
        waitingMessage.className = 'bg-blue-50 p-3 rounded-lg mt-4 text-center';
        waitingMessage.innerHTML = '<- Click next round when everyone is ready!';
        // Cast to HTMLElement to handle the type error
        (answersArea as HTMLElement).appendChild(waitingMessage);
      }
    }
  });

  // Handle rounds configuration
  socket.on('rounds_set', (totalRounds: number) => {
    // Update UI to show number of rounds configured
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = `Game configured for ${totalRounds} rounds. Ready to start!`;
    }

    // Create and show a round info banner at the top if it doesn't exist yet
    const roomInfoArea = document.getElementById('room-info-area');
    if (roomInfoArea) {
      // Check if rounds info already exists
      let roundsInfo = document.getElementById('rounds-info');
      if (!roundsInfo) {
        // Create the rounds info element if it doesn't exist
        roundsInfo = document.createElement('div');
        roundsInfo.id = 'rounds-info';
        roundsInfo.className = 'rounds-counter';
        roundsInfo.textContent = `${totalRounds} rounds`;

        // Add it to the room info area
        roomInfoArea.appendChild(roundsInfo);
      } else {
        // Update existing rounds info
        roundsInfo.textContent = `${totalRounds} rounds`;
      }
    }
  });

  // Handle disabling rounds input when any player sets the rounds
  socket.on('disable_rounds_input', (roundCount: number) => {
    const roundCountInput = document.getElementById('round-count') as HTMLInputElement;
    const setRoundsButton = document.getElementById('set-rounds-button') as HTMLButtonElement;

    if (roundCountInput && setRoundsButton) {
      // Hide round input and button
      const inputContainer = document.getElementById('rounds-input-container');
      if (inputContainer) {
        inputContainer.classList.add('hidden');
      }

      // Create and show a round info banner at the top
      const roomInfoArea = document.getElementById('room-info-area');
      if (roomInfoArea) {
        // Check if rounds info already exists
        let roundsInfo = document.getElementById('rounds-info');
        if (!roundsInfo) {
          // Create the rounds info element if it doesn't exist
          roundsInfo = document.createElement('div');
          roundsInfo.id = 'rounds-info';
          roundsInfo.className = 'rounds-counter';
          roundsInfo.textContent = `${roundCount} rounds`;

          // Add it to the room info area
          roomInfoArea.appendChild(roundsInfo);
        } else {
          // Update existing rounds info
          roundsInfo.textContent = `${roundCount} rounds`;
        }
      }
    }
  });

  // Handle loading indicator for all players when any player starts the game
  socket.on('loading_game', () => {
    // Show loading indicator on start button for all players
    const startButton = document.getElementById('start-round-button') as HTMLButtonElement;
    if (startButton) {
      const buttonText = startButton.textContent || '';
      startButton.innerHTML = '<span class="animate-spin inline-block mr-2">⟳</span> Loading...';
      startButton.disabled = true;
      startButton.classList.add('opacity-50');

      // Add a timeout to restore button if server doesn't respond
      setTimeout(() => {
        // Only restore if button is still visible and in loading state
        if (!startButton.classList.contains('hidden') && startButton.disabled) {
          startButton.innerHTML = buttonText;
          startButton.disabled = false;
          startButton.classList.remove('opacity-50');
        }
      }, 10000); // 10 seconds timeout
    }
  });

  // Handle hiding game controls when the game actually starts
  socket.on('hide_game_controls', () => {
    // Hide start button
    const startButton = document.getElementById('start-round-button') as HTMLButtonElement;
    if (startButton) {
      // Now hide the button (loading state will be preserved)
      startButton.classList.add('hidden');
    }

    // Hide round config which contains AI prompt text box
    const roundConfig = document.getElementById('round-config');
    if (roundConfig) {
      roundConfig.classList.add('hidden');
    }
  });

  // Handle disabling imposter prompt input after submission
  socket.on('disable_imposter_prompt', () => {
    const aiImposterPrompt = document.getElementById('ai-imposter-prompt') as HTMLTextAreaElement;
    const submitImposterPromptButton = document.getElementById(
      'submit-imposter-prompt',
    ) as HTMLButtonElement;

    if (aiImposterPrompt && submitImposterPromptButton) {
      // Disable input and button
      aiImposterPrompt.disabled = true;
      submitImposterPromptButton.disabled = true;

      // Add visual indication that they're disabled
      submitImposterPromptButton.classList.add('opacity-50');
      submitImposterPromptButton.textContent = 'Submitted ✓';

      // Add a note to indicate that the prompt was submitted
      const promptNote = document.createElement('div');
      promptNote.className = 'text-sm text-green-600 mt-1';
      promptNote.textContent =
        'Your instructions have been submitted! All player instructions will be combined.';

      // Insert the note after the container of the imposter prompt
      const promptContainer = aiImposterPrompt.closest('div');
      if (promptContainer?.parentNode) {
        promptContainer.parentNode.insertBefore(promptNote, promptContainer.nextSibling);
      }
    }
  });

  // Handle disabling custom question input after submission
  socket.on('disable_custom_question', () => {
    const customQuestionInput = document.getElementById(
      'custom-question-input',
    ) as HTMLTextAreaElement;
    const submitCustomQuestionButton = document.getElementById(
      'submit-custom-question',
    ) as HTMLButtonElement;

    if (customQuestionInput && submitCustomQuestionButton) {
      // Disable input and button
      customQuestionInput.disabled = true;
      submitCustomQuestionButton.disabled = true;

      // Add visual indication that they're disabled
      submitCustomQuestionButton.classList.add('opacity-50');
      submitCustomQuestionButton.textContent = 'Submitted ✓';

      // Add a note to indicate that the question was submitted
      const questionNote = document.createElement('div');
      questionNote.className = 'text-sm text-green-600 mt-1';
      questionNote.textContent =
        'Your question has been submitted! It may be used in upcoming rounds.';

      // Insert the note after the container of the custom question input
      const questionContainer = customQuestionInput.closest('div');
      if (questionContainer?.parentNode) {
        questionContainer.parentNode.insertBefore(questionNote, questionContainer.nextSibling);
      }
    }
  });

  // Handle updating the custom question count display
  socket.on('custom_question_count', (count: number) => {
    // Update the count display if it exists
    const customQuestionCountDisplay = document.getElementById('custom-question-count');
    if (customQuestionCountDisplay) {
      customQuestionCountDisplay.textContent = count.toString();
      customQuestionCountDisplay.classList.remove('hidden');

      // Update the label text based on count
      const countLabel = document.getElementById('custom-question-count-label');
      if (countLabel) {
        countLabel.textContent = count === 1 ? 'question submitted' : 'questions submitted';
      }
    }
  });

  socket.on('game_complete', (data: GameComplete) => {
    // Update player votes received
    if (data.playerVotesReceived) {
      playerVotesReceived = data.playerVotesReceived;
    }

    // Update status message
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = 'Game complete! All rounds finished.';
    }

    // Create a dedicated final results page
    createFinalResultsPage(data);

    // Show a "New Game" button to restart
    const startButtonContainer = document.getElementById('start-button-container');
    const roundConfig = document.getElementById('round-config');

    if (startButtonContainer) {
      startButtonContainer.innerHTML = `
        <button id="new-game-button" class="button button-success w-full text-lg font-semibold">
          Start New Game
        </button>
      `;

      // Add event listener for new game button
      const newGameButton = document.getElementById('new-game-button');
      if (newGameButton && roundConfig) {
        // Show round configuration when starting a new game
        roundConfig.classList.remove('hidden');

        newGameButton.addEventListener('click', () => {
          // Reload the page for simplicity
          window.location.reload();
        });
      }
    }
  });

  // Function to create the final results page
  function createFinalResultsPage(data: GameComplete): void {
    // Only destructure what we use directly
    const {
      playerAIDetectionSuccess,
      playerVotesReceived,
      aiPlayer,
      players,
      combinedImposterPrompt,
      playerImposterPrompts,
    } = data;

    // We access other properties directly from the data object when needed

    // Clear existing content in public answers area
    const answersArea = document.getElementById('public-answers-area');
    if (!answersArea) return;

    answersArea.innerHTML = '';

    // Create final results container
    const resultsContainer = document.createElement('div');
    resultsContainer.className = 'final-results-container bg-white rounded-lg p-5 shadow-lg';

    // Add header
    const header = document.createElement('h2');
    header.className = 'text-2xl font-bold text-center mb-6';
    header.innerHTML = '🏆 Final Results 🏆';
    resultsContainer.appendChild(header);

    // Create leaderboard at the top
    const leaderboardSection = document.createElement('section');
    leaderboardSection.className = 'mb-8';

    // Create title for leaderboard
    const leaderboardTitle = document.createElement('h3');
    leaderboardTitle.className = 'text-xl font-semibold mb-4 border-b pb-2';
    leaderboardTitle.textContent = 'Leaderboard';
    leaderboardSection.appendChild(leaderboardTitle);

    // Create the leaderboard table
    const leaderboardTable = document.createElement('div');
    leaderboardTable.className = 'w-full overflow-hidden rounded-lg border border-gray-200';

    // Table header
    const tableHeader = document.createElement('div');
    tableHeader.className =
      'grid grid-cols-5 gap-1 p-3 bg-gray-100 border-b border-gray-200 font-semibold';
    tableHeader.innerHTML = `
      <div>Rank</div>
      <div>Player</div>
      <div>Detection Points</div>
      <div>Deception Points</div>
      <div>Total Score</div>
    `;
    leaderboardTable.appendChild(tableHeader);

    // Sort players by score in descending order
    const sortedPlayers = Object.entries(players)
      .filter(([id]) => id !== aiPlayer.id) // Filter out AI player
      .sort(([, playerA], [, playerB]) => playerB.score - playerA.score);

    // Add player rows
    sortedPlayers.forEach(([playerId, player], index) => {
      // Calculate scores
      const detectionPoints = (playerAIDetectionSuccess[playerId] || 0) * 2; // 2 points per correct detection
      const votesReceived = playerVotesReceived[playerId] || 0;
      const totalScore = player.score;

      // Create rank indicator with medal for top 3
      let rankDisplay = '';
      if (index === 0) {
        rankDisplay = '🥇 1st';
      } else if (index === 1) {
        rankDisplay = '🥈 2nd';
      } else if (index === 2) {
        rankDisplay = '🥉 3rd';
      } else {
        rankDisplay = `${index + 1}th`;
      }

      // Create row
      const playerRow = document.createElement('div');
      playerRow.className = 'grid grid-cols-5 gap-1 p-3 border-b border-gray-200';

      // Highlight current player
      if (playerId === myPlayerId) {
        playerRow.classList.add('font-bold', 'bg-blue-100');
      }

      // Highlight winners
      if (index === 0) {
        playerRow.classList.add('bg-yellow-50');
      }

      playerRow.innerHTML = `
        <div class="font-semibold">${rankDisplay}</div>
        <div>${player.name}${playerId === myPlayerId ? ' <span class="text-blue-600">(you)</span>' : ''}</div>
        <div>${detectionPoints} <span class="text-sm text-gray-500">(${playerAIDetectionSuccess[playerId] || 0} × 2pts)</span></div>
        <div>${votesReceived} <span class="text-sm text-gray-500">(votes received × 1pt)</span></div>
        <div class="font-semibold">${totalScore}</div>
      `;

      leaderboardTable.appendChild(playerRow);
    });

    // Add AI player as last row with special styling
    const aiRow = document.createElement('div');
    aiRow.className = 'grid grid-cols-5 gap-1 p-3 border-b border-gray-200 bg-red-50';

    // AI gets 1 point per round they survived without detection
    const aiSurvivalPoints = players[aiPlayer.id]?.score || 0;

    aiRow.innerHTML = `
      <div class="font-semibold">AI</div>
      <div>${aiPlayer.name} <span class="text-red-600">(AI)</span></div>
      <div>0</div>
      <div>${aiSurvivalPoints} <span class="text-sm text-gray-500">(survival × 1pt)</span></div>
      <div class="font-semibold">${aiSurvivalPoints}</div>
    `;

    leaderboardTable.appendChild(aiRow);
    leaderboardSection.appendChild(leaderboardTable);
    resultsContainer.appendChild(leaderboardSection);

    // Add scoring explanation section
    const scoringSection = document.createElement('section');
    scoringSection.className = 'mb-8 p-4 bg-gray-50 rounded-lg';

    const scoringTitle = document.createElement('h3');
    scoringTitle.className = 'text-xl font-semibold mb-3';
    scoringTitle.textContent = 'How Scoring Works';
    scoringSection.appendChild(scoringTitle);

    const scoringExplanation = document.createElement('div');
    scoringExplanation.className = 'text-sm space-y-2';
    scoringExplanation.innerHTML = `
      <p>• <strong>Detection Points:</strong> Human players get +2 points each time they correctly identified the AI</p>
      <p>• <strong>Deception Points:</strong> Human players get +1 point for each vote received (including votes from the AI)</p>
      <p>• <strong>AI Points:</strong> The AI gets +1 point for surviving each round without being detected</p>
    `;
    scoringSection.appendChild(scoringExplanation);
    resultsContainer.appendChild(scoringSection);

    // Add AI Imposter Instructions section
    const imposterSection = document.createElement('section');
    imposterSection.className = 'mb-8 p-4 bg-gray-50 rounded-lg';

    const imposterTitle = document.createElement('h3');
    imposterTitle.className = 'text-xl font-semibold mb-3';
    imposterTitle.textContent = 'AI Imposter Instructions';
    imposterSection.appendChild(imposterTitle);

    // Include explanation of AI's behavior
    const aiExplanation = document.createElement('p');
    aiExplanation.className = 'mb-4 italic';
    aiExplanation.textContent = `The AI imposter (${aiPlayer.name}) was instructed to answer questions while trying to blend in with human players.`;
    imposterSection.appendChild(aiExplanation);

    // Show combined imposter prompt if available
    if (combinedImposterPrompt) {
      const combinedPromptDiv = document.createElement('div');
      combinedPromptDiv.className = 'mb-4 p-3 bg-white rounded border border-gray-200';

      const combinedPromptTitle = document.createElement('h4');
      combinedPromptTitle.className = 'font-semibold mb-2';
      combinedPromptTitle.textContent = 'Combined Instructions:';
      combinedPromptDiv.appendChild(combinedPromptTitle);

      const combinedPromptText = document.createElement('p');
      combinedPromptText.className = 'text-sm italic';
      combinedPromptText.textContent = combinedImposterPrompt;
      combinedPromptDiv.appendChild(combinedPromptText);

      imposterSection.appendChild(combinedPromptDiv);
    }

    // Show individual player instructions
    if (playerImposterPrompts && Object.keys(playerImposterPrompts).length > 0) {
      const playerPromptSection = document.createElement('div');
      playerPromptSection.className = 'mt-4';

      const playerPromptTitle = document.createElement('h4');
      playerPromptTitle.className = 'font-semibold mb-2';
      playerPromptTitle.textContent = 'Individual Player Instructions:';
      playerPromptSection.appendChild(playerPromptTitle);

      // Create a collapsible section
      const playerPromptToggle = document.createElement('button');
      playerPromptToggle.className = 'text-blue-500 hover:text-blue-700 mb-2 text-sm font-semibold';
      playerPromptToggle.textContent = 'Show Individual Instructions';
      playerPromptSection.appendChild(playerPromptToggle);

      const playerPromptContent = document.createElement('div');
      playerPromptContent.className = 'hidden space-y-2';

      // Sort entries by player name
      const sortedPrompts = Object.entries(playerImposterPrompts)
        .map(([playerId, prompt]) => ({
          playerName: players[playerId]?.name || 'Unknown Player',
          playerId,
          prompt,
        }))
        .sort((a, b) => a.playerName.localeCompare(b.playerName));

      for (const { playerName, playerId, prompt } of sortedPrompts) {
        const promptItem = document.createElement('div');
        promptItem.className = 'p-2 bg-white rounded border border-gray-200';

        const promptHeader = document.createElement('div');
        promptHeader.className = 'font-semibold';
        promptHeader.innerHTML = `${playerName}${playerId === myPlayerId ? ' <span class="text-blue-600">(you)</span>' : ''}:`;
        promptItem.appendChild(promptHeader);

        const promptText = document.createElement('div');
        promptText.className = 'text-sm italic ml-4';
        promptText.textContent = prompt;
        promptItem.appendChild(promptText);

        playerPromptContent.appendChild(promptItem);
      }

      playerPromptSection.appendChild(playerPromptContent);
      imposterSection.appendChild(playerPromptSection);

      // Add toggle functionality
      playerPromptToggle.addEventListener('click', () => {
        const isHidden = playerPromptContent.classList.contains('hidden');
        playerPromptContent.classList.toggle('hidden', !isHidden);
        playerPromptToggle.textContent = isHidden
          ? 'Hide Individual Instructions'
          : 'Show Individual Instructions';
      });
    }

    resultsContainer.appendChild(imposterSection);

    // Add question history section
    // Create collapsible rounds history
    const roundsHistorySection = document.createElement('section');
    roundsHistorySection.className = 'mt-8';

    const roundsHistoryTitle = document.createElement('h3');
    roundsHistoryTitle.className = 'text-xl font-semibold mb-4 border-b pb-2';
    roundsHistoryTitle.textContent = 'Round-by-Round History';
    roundsHistorySection.appendChild(roundsHistoryTitle);

    // Get history from rounds data
    if (data.allRoundsVotes && data.allRoundsVotes.length > 0) {
      // Sort rounds chronologically
      const sortedRounds = [...data.allRoundsVotes].sort((a, b) => a.roundNumber - b.roundNumber);

      // Create accordion for all rounds
      const roundsAccordion = document.createElement('div');
      roundsAccordion.className = 'space-y-3';

      // Create a map of round number to history data for easy lookup
      const historyMap = new Map();
      if (data.roundsHistory && data.roundsHistory.length > 0) {
        for (const historyItem of data.roundsHistory) {
          historyMap.set(historyItem.roundNumber, historyItem);
        }
      }

      for (const round of sortedRounds) {
        const roundPanel = document.createElement('div');
        roundPanel.className = 'border border-gray-200 rounded-lg overflow-hidden';

        // Create header button
        const roundHeader = document.createElement('button');
        roundHeader.className =
          'w-full bg-gray-100 px-4 py-3 text-left font-semibold flex items-center justify-between hover:bg-gray-200';
        roundHeader.innerHTML = `
          <span>Round ${round.roundNumber}</span>
          <span class="text-gray-500 text-sm">▼</span>
        `;
        roundPanel.appendChild(roundHeader);

        // Create collapsible content
        const roundContent = document.createElement('div');
        roundContent.className = 'hidden p-4 bg-white';

        // Get round history data if available
        const historyItem = historyMap.get(round.roundNumber);

        // Try to get the prompt for this round
        let roundPrompt = 'Question not available';

        // First try to get prompt from history
        if (historyItem?.prompt) {
          roundPrompt = historyItem.prompt;
        }
        // Fall back to current prompt for last round
        else if (data.currentPrompt && round.roundNumber === sortedRounds.length) {
          roundPrompt = data.currentPrompt;
        }

        // Add the question
        const questionDiv = document.createElement('div');
        questionDiv.className = 'mb-4';
        questionDiv.innerHTML = `
          <h4 class="font-semibold mb-2">Question:</h4>
          <p class="italic">${roundPrompt}</p>
        `;
        roundContent.appendChild(questionDiv);

        // Add answers section
        const answersDiv = document.createElement('div');
        answersDiv.className = 'mb-4';
        answersDiv.innerHTML = `<h4 class="font-semibold mb-2">Answers:</h4>`;

        // Add answers from round history if available
        if (historyItem?.answers && Object.keys(historyItem.answers).length > 0) {
          const answersList = document.createElement('div');
          answersList.className = 'space-y-2';

          // We need to explicitly type this to avoid type errors
          type AnswerType = {
            playerId: string;
            answer: string;
            timeSpent: number;
          };

          // Sort answers by player name for consistent display
          const sortedAnswers = Object.values(historyItem.answers)
            .map((answer) => {
              const typedAnswer = answer as AnswerType;
              return {
                playerName: players[typedAnswer.playerId]?.name || 'Unknown Player',
                isAI: typedAnswer.playerId === aiPlayer.id,
                answer: typedAnswer.answer,
                timeSpent: typedAnswer.timeSpent,
                playerId: typedAnswer.playerId,
              };
            })
            .sort((a, b) => a.playerName.localeCompare(b.playerName));

          for (const answerData of sortedAnswers) {
            // Format time spent in seconds
            const timeSpentSeconds = Math.round(answerData.timeSpent / 1000);
            const timeDisplay = timeSpentSeconds > 0 ? `${timeSpentSeconds}s` : 'Time expired';

            const answerItem = document.createElement('div');
            answerItem.className = 'p-2 border border-gray-200 rounded bg-gray-50';

            // Highlight AI answers
            if (answerData.isAI) {
              answerItem.classList.add('bg-red-50', 'border-red-200');
            }

            answerItem.innerHTML = `
              <div class="flex justify-between mb-1">
                <span class="font-semibold ${answerData.isAI ? 'text-red-600' : ''}">${answerData.playerName}${answerData.isAI ? ' (AI)' : ''}</span>
                <span class="text-xs text-gray-500">Time: ${timeDisplay}</span>
              </div>
              <div class="text-sm">
                ${answerData.answer || '<em class="text-gray-400">No answer provided</em>'}
              </div>
            `;

            answersList.appendChild(answerItem);
          }

          answersDiv.appendChild(answersList);
        } else {
          // No answers available
          answersDiv.innerHTML += `<p class="text-sm text-gray-500">(Answers not available in history)</p>`;
        }
        roundContent.appendChild(answersDiv);

        // Add voting results
        const votingDiv = document.createElement('div');
        votingDiv.className = 'mb-2';
        votingDiv.innerHTML = `<h4 class="font-semibold mb-2">Voting Results:</h4>`;

        // Count votes for each player
        const voteCounts: Record<string, number> = {};
        if (round.votes) {
          for (const votedForId of Object.values(round.votes)) {
            if (typeof votedForId === 'string') {
              voteCounts[votedForId] = (voteCounts[votedForId] || 0) + 1;
            }
          }
        }

        // Create a list of who voted for whom
        const votesList = document.createElement('ul');
        votesList.className = 'list-disc pl-5 text-sm space-y-1';

        for (const [votedForId, count] of Object.entries(voteCounts)) {
          const playerName = players[votedForId]?.name || 'Unknown';
          const isAI = votedForId === aiPlayer.id;

          const voteItem = document.createElement('li');
          voteItem.innerHTML = `
            <span class="${isAI ? 'text-red-600 font-semibold' : ''}">${playerName}${isAI ? ' (AI)' : ''}</span>:
            received ${count} vote${count !== 1 ? 's' : ''}
          `;
          votesList.appendChild(voteItem);
        }

        votingDiv.appendChild(votesList);
        roundContent.appendChild(votingDiv);

        roundPanel.appendChild(roundContent);
        roundsAccordion.appendChild(roundPanel);

        // Add toggle functionality
        roundHeader.addEventListener('click', () => {
          const isHidden = roundContent.classList.contains('hidden');
          roundContent.classList.toggle('hidden', !isHidden);
          const arrow = roundHeader.querySelector('span:last-child');
          if (arrow) {
            arrow.textContent = isHidden ? '▲' : '▼';
          }
        });
      }

      roundsHistorySection.appendChild(roundsAccordion);
    } else {
      // No rounds data available
      const noRoundsMessage = document.createElement('p');
      noRoundsMessage.className = 'text-gray-500 italic';
      noRoundsMessage.textContent = 'No round history available.';
      roundsHistorySection.appendChild(noRoundsMessage);
    }

    resultsContainer.appendChild(roundsHistorySection);

    // Append the entire results container to the answers area
    answersArea.appendChild(resultsContainer);
  }

  // Add event listeners for UI elements
  setupEventListeners();
});

// Helper function to handle joined room logic (whether created or joined)
function handleRoomJoined(data: RoomData): void {
  const { roomCode, player } = data;

  // Store room code
  myRoomCode = roomCode;
  myPlayerId = player.id;

  // Hide room selection area and game description
  const roomSelectionArea = document.getElementById('room-selection-area');
  const gameDescription = document.getElementById('game-description');

  if (roomSelectionArea) {
    roomSelectionArea.classList.add('hidden');
  }

  if (gameDescription) {
    gameDescription.classList.add('hidden');
  }

  // Show room info and game grid (but hide answer area until game starts)
  const roomInfoArea = document.getElementById('room-info-area');
  const roomCodeDisplay = document.getElementById('room-code-display');
  const gameGrid = document.getElementById('game-grid');
  const answerArea = document.getElementById('answer-area');

  if (roomInfoArea && roomCodeDisplay) {
    roomInfoArea.classList.remove('hidden');
    roomCodeDisplay.textContent = roomCode;

    // Add click-to-copy functionality
    roomCodeDisplay.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(roomCode);

        // Show temporary success feedback
        const originalContent = roomCodeDisplay.textContent;
        roomCodeDisplay.textContent = 'Copied!';

        // Reset after a short delay
        setTimeout(() => {
          roomCodeDisplay.textContent = originalContent;
        }, 1000);
      } catch (err) {
        console.error('Failed to copy room code:', err);
      }
    });
  }

  if (gameGrid) {
    // Show the game grid but add the waiting-state class to make player list full width
    gameGrid.classList.remove('hidden');
    gameGrid.classList.add('waiting-state');
  }

  if (answerArea) {
    // Hide the answer area until the game actually starts
    answerArea.classList.add('hidden');
  }

  // Initialize player count (just you to start with)
  updatePlayerCount(1);

  // Request players update to get accurate count
  socket.emit('request_players_update');
}

// Helper function to clear element content
function clearElementContent(elementId: string): void {
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = '';
  }
}

// Setup event listeners
function setupEventListeners(): void {
  // The join button is no longer needed since room selection is shown by default

  // Create room button click handler
  const createRoomButton = document.getElementById('create-room-button');
  if (createRoomButton) {
    createRoomButton.addEventListener('click', () => {
      socket.emit('create_room');
    });
  }

  // Join room button click handler
  const joinRoomButton = document.getElementById('join-room-button');
  const roomCodeInput = document.getElementById('room-code-input') as HTMLInputElement;

  if (joinRoomButton && roomCodeInput) {
    joinRoomButton.addEventListener('click', () => {
      const roomCode = roomCodeInput.value.trim().toUpperCase();

      if (roomCode) {
        socket.emit('join_room', roomCode);
      } else {
        // Show error if no room code entered
        const statusMessage = document.getElementById('status-message');
        if (statusMessage) {
          statusMessage.textContent = 'Please enter a room code.';
          statusMessage.classList.remove('bg-blue-500');
          statusMessage.classList.add('bg-red-500');

          // Reset back to blue after 3 seconds
          setTimeout(() => {
            statusMessage.classList.remove('bg-red-500');
            statusMessage.classList.add('bg-blue-500');
          }, 3000);
        }
      }
    });

    // Also allow pressing Enter to join room
    roomCodeInput.addEventListener('keyup', (event) => {
      if (event.key === 'Enter') {
        joinRoomButton.click();
      }
    });
  }

  // Set rounds button click handler
  const setRoundsButton = document.getElementById('set-rounds-button');
  const roundCountInput = document.getElementById('round-count') as HTMLInputElement;

  if (setRoundsButton && roundCountInput) {
    setRoundsButton.addEventListener('click', () => {
      const roundCount = Number.parseInt(roundCountInput.value, 10);
      if (roundCount >= 1 && roundCount <= 10) {
        socket.emit('set_rounds', roundCount);

        // The server will emit 'disable_rounds_input' event to all players
        // The button will be disabled by the event handler, not here
      }
    });
  }

  // Submit AI imposter prompt button
  const submitImposterPromptButton = document.getElementById('submit-imposter-prompt');
  if (submitImposterPromptButton) {
    submitImposterPromptButton.addEventListener('click', () => {
      const aiImposterPrompt = document.getElementById('ai-imposter-prompt') as HTMLTextAreaElement;
      let imposterPrompt = '';

      if (aiImposterPrompt?.value.trim()) {
        imposterPrompt = aiImposterPrompt.value.trim();

        // Send just the imposter prompt
        socket.emit('submit_imposter_prompt', {
          imposterPrompt,
        });

        // The server will handle validation and sending the disable_imposter_prompt event
        // The client will get a status message from the server
      }
    });
  }

  // Submit custom question button
  const submitCustomQuestionButton = document.getElementById('submit-custom-question');
  if (submitCustomQuestionButton) {
    submitCustomQuestionButton.addEventListener('click', () => {
      const customQuestionInput = document.getElementById(
        'custom-question-input',
      ) as HTMLTextAreaElement;

      if (customQuestionInput?.value.trim()) {
        const customQuestion = customQuestionInput.value.trim();

        // Send the custom question to the server
        socket.emit('submit_custom_question', {
          customQuestion,
        });

        // The server will handle validation and sending the disable_custom_question event
      }
    });
  }

  // Start round button click handler
  const startRoundButton = document.getElementById('start-round-button');
  if (startRoundButton) {
    startRoundButton.addEventListener('click', () => {
      // Change button state to loading (will be applied to all clients via the server event)
      socket.emit('request_start_round');

      // The server will emit loading state and hide game controls events to all clients
    });
  }

  // Submit answer button click handler
  const submitAnswerButton = document.getElementById('submit-answer-button');
  if (submitAnswerButton) {
    submitAnswerButton.addEventListener('click', () => {
      const answerInput = document.getElementById('answer-input') as HTMLTextAreaElement;
      const answer = answerInput.value.trim();

      // Always submit the answer, even if empty
      // Calculate time spent (from start until now)
      const timeSpent = roundEndTime - Date.now();

      // Emit answer to server
      socket.emit('submit_answer', {
        answer,
        timeSpent: Math.max(0, timeSpent),
      });

      // Disable input and hide button
      answerInput.disabled = true;
      submitAnswerButton.classList.add('hidden');

      // Update status
      const statusMessage = document.getElementById('status-message');
      if (statusMessage) {
        statusMessage.textContent = 'Answer submitted! Waiting for others...';
      }
    });
  }
}

// Update timer display
function updateTimerDisplay(): void {
  const timerDisplay = document.getElementById('timer-display');
  if (!timerDisplay) return;

  const remainingTime = Math.max(0, roundEndTime - Date.now());
  const seconds = Math.ceil(remainingTime / 1000);

  // Visual feedback based on remaining time
  if (seconds <= 5) {
    timerDisplay.classList.remove('timer-normal', 'timer-warning');
    timerDisplay.classList.add('timer-danger');
  } else if (seconds <= 10) {
    timerDisplay.classList.remove('timer-normal', 'timer-danger');
    timerDisplay.classList.add('timer-warning');
  } else {
    timerDisplay.classList.remove('timer-warning', 'timer-danger');
    timerDisplay.classList.add('timer-normal');
  }

  timerDisplay.textContent = `Time remaining: ${seconds} seconds`;

  // Handle timer expiration
  if (remainingTime <= 0) {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    // Determine which phase we're in by checking elements
    const answerInput = document.getElementById('answer-input') as HTMLTextAreaElement;
    const submitButton = document.getElementById('submit-answer-button') as HTMLButtonElement;
    // votingArea is intentionally unused here as we only need to check for voting-hint

    // Handle challenge phase expiration
    if (answerInput && !answerInput.classList.contains('hidden')) {
      // Check if the input is not disabled - a disabled input means the answer was already submitted
      if (!answerInput.disabled) {
        // Explicitly click the submit button if it exists - now it will work with empty answers
        if (submitButton && !submitButton.classList.contains('hidden') && !submitButton.disabled) {
          console.log('Timer expired - clicking submit button');
          submitButton.click();
        } else {
          // Fallback: Submit directly if the button isn't available for some reason
          console.log('Timer expired - submitting directly');
          socket.emit('submit_answer', {
            answer: answerInput.value.trim(), // Submit whatever is in the box
            timeSpent: 0, // Time's up
          });

          // Disable input and hide button
          answerInput.disabled = true;
          if (submitButton) {
            submitButton.classList.add('hidden');
          }

          // Update status
          const statusMessage = document.getElementById('status-message');
          if (statusMessage) {
            statusMessage.textContent = "Time's up! Your answer has been submitted.";
          }
        }
      }
    }
    // Handle voting phase expiration - now we need to check if we're in voting phase
    else if (document.querySelector('.voting-hint')) {
      // We're in the voting phase, find all clickable answer cards
      const answerCards = Array.from(document.querySelectorAll('.answer-card.vote-enabled'));

      // Filter out cards that are the current player (can't vote for yourself)
      const validCards = answerCards.filter((card) => {
        const playerName = (card as HTMLElement).dataset.playerName;
        const playerEntry = Object.entries(currentPlayers).find(
          ([, player]) => player.name === playerName,
        );
        return playerEntry && playerEntry[0] !== myPlayerId;
      });

      if (validCards.length > 0) {
        // Pick a random player to vote for
        const randomIndex = Math.floor(Math.random() * validCards.length);
        (validCards[randomIndex] as HTMLElement).click();

        // Update status
        const statusMessage = document.getElementById('status-message');
        if (statusMessage) {
          statusMessage.textContent = "Time's up! A random vote has been cast.";
        }
      }
    }
  }
}

// Define raw colors directly - bypass Tailwind completely
const rawColors = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#10b981', // green
  '#eab308', // yellow
  '#8b5cf6', // purple
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
  '#84cc16', // lime
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#f43f5e', // rose
  '#f59e0b', // amber
  '#d946ef', // fuchsia
  '#9333ea', // violet-600
  '#0891b2', // cyan-600
];

// Render player list with completely inline styles
function renderPlayerList(serverPlayers: Record<string, Player>): void {
  console.log(
    '[RENDER_PLAYER_LIST] Attempting to render player list with players:',
    Object.keys(serverPlayers).length,
  );

  const playerList = document.getElementById('player-list');
  if (!playerList) {
    console.log('[RENDER_PLAYER_LIST] Player list element not found in DOM');
    return;
  }

  // Track game state - we're in waiting state if prompt area is empty AND there's no timer display visible
  // This ensures player list appears as soon as a challenge starts
  const promptArea = document.getElementById('prompt-area');
  const timerDisplay = document.getElementById('timer-display');
  const isWaiting =
    !promptArea?.textContent && timerDisplay?.classList.contains('hidden') !== false;

  console.log('[RENDER_PLAYER_LIST] Game state - isWaiting:', isWaiting);

  // Get player list header elements
  const playerTitle = document.querySelector('#player-list-container h2');
  const votesReceivedLabel = document.querySelector('#player-list-container .text-gray-500');

  // In waiting state, hide the player list title and votes received label
  if (playerTitle && votesReceivedLabel) {
    if (isWaiting) {
      // Hide the player list header in waiting state
      playerTitle.classList.add('hidden');
      votesReceivedLabel.classList.add('hidden');
    } else {
      // In game, show the player list header
      playerTitle.classList.remove('hidden');
      playerTitle.textContent = 'Players';
      votesReceivedLabel.classList.remove('hidden');
    }
  }

  // Clear the player list
  playerList.innerHTML = '';

  // In waiting state, don't show any players
  if (isWaiting) {
    return;
  }

  // Sort players alphabetically by name
  const sortedPlayers = Object.values(serverPlayers).sort((a, b) => a.name.localeCompare(b.name));

  for (const player of sortedPlayers) {
    const playerItem = document.createElement('div');
    playerItem.className = 'player-list-item';

    // Add style for the player item
    playerItem.style.padding = '0.75rem';
    playerItem.style.borderBottom = '1px solid #e5e7eb';
    playerItem.style.display = 'flex';
    playerItem.style.justifyContent = 'space-between';
    playerItem.style.alignItems = 'center';

    // Highlight current player
    if (player.id === myPlayerId) {
      playerItem.style.backgroundColor = '#f0f9ff';
      playerItem.style.fontWeight = '600';
    }

    // Get vote count for player (default to 0 if not found)
    const voteCount = playerVotesReceived[player.id] || 0;

    // Get the player index and raw color
    const playerIndex = getPlayerIndex(player.id);
    const playerColor = rawColors[playerIndex];

    // Get first letter of name for avatar
    const firstLetter = player.name.charAt(0).toUpperCase();

    // Create player info container (left side)
    const playerInfoDiv = document.createElement('div');
    playerInfoDiv.style.display = 'flex';
    playerInfoDiv.style.alignItems = 'center';

    // Create avatar with inline styles
    const avatarDiv = document.createElement('div');
    avatarDiv.style.width = '2rem';
    avatarDiv.style.height = '2rem';
    avatarDiv.style.borderRadius = '9999px';
    avatarDiv.style.backgroundColor = playerColor;
    avatarDiv.style.display = 'flex';
    avatarDiv.style.alignItems = 'center';
    avatarDiv.style.justifyContent = 'center';
    avatarDiv.style.color = 'white';
    avatarDiv.style.fontWeight = '600';
    avatarDiv.style.marginRight = '0.75rem';
    avatarDiv.textContent = firstLetter;

    // Add player name span - no rank display
    const nameSpan = document.createElement('span');
    nameSpan.innerHTML = `${player.name}${player.id === myPlayerId ? ' <span style="color: #2563eb;">(you)</span>' : ''}`;

    // Create vote counter container (right side)
    const voteDiv = document.createElement('div');
    voteDiv.style.display = 'flex';
    voteDiv.style.flexDirection = 'row';
    voteDiv.style.alignItems = 'center';

    // Vote counter
    const voteCounterSpan = document.createElement('span');
    voteCounterSpan.style.backgroundColor = '#a5b4fc';
    voteCounterSpan.style.color = 'white';
    voteCounterSpan.style.borderRadius = '9999px';
    voteCounterSpan.style.padding = '0.25rem 0.75rem';
    voteCounterSpan.style.fontSize = '0.875rem';
    voteCounterSpan.style.fontWeight = '600';
    voteCounterSpan.textContent = voteCount.toString();

    // Assemble the player item
    playerInfoDiv.appendChild(avatarDiv);
    playerInfoDiv.appendChild(nameSpan);

    voteDiv.appendChild(voteCounterSpan);

    playerItem.appendChild(playerInfoDiv);
    playerItem.appendChild(voteDiv);

    // Add to player list
    playerList.appendChild(playerItem);

    // Log successful creation
    console.log(`[COLOR_DEBUG] Created avatar for ${player.name} with color ${playerColor}`);
  }
}

// Update player count display
function updatePlayerCount(count: number): void {
  const playerCountElement = document.getElementById('player-count');
  if (playerCountElement) {
    playerCountElement.textContent = count.toString();
  }
}

// We're using direct color values now, so no need for this function
// function getCssColorFromTailwindClass(tailwindClass: string): string {
//   // Default color if not found in map
//   return colorMap[tailwindClass] || '#a5b4fc';
// }

// Debug function to check if player colors are actually being applied
function checkPlayerAvatarColors(): void {
  console.log('[COLOR_CHECK] Checking player avatars in DOM');
  // In our new implementation, we don't use .player-avatar class anymore
  // This is now just for debugging legacy elements
  const avatarDivs = Array.from(document.querySelectorAll('[style*="background-color"]')).filter(
    (el) =>
      el instanceof HTMLElement &&
      el.style.width === '2rem' &&
      el.style.height === '2rem' &&
      el.style.borderRadius === '9999px',
  );

  console.log(`[COLOR_CHECK] Found ${avatarDivs.length} player avatars in DOM with inline styles`);

  avatarDivs.forEach((avatar, index) => {
    if (avatar instanceof HTMLElement) {
      const color = avatar.style.backgroundColor;
      const text = avatar.textContent || '';
      console.log(`[COLOR_CHECK] Avatar ${index + 1} has color: ${color}, text: ${text}`);
    }
  });
}

// Cast vote
function castVote(votedPlayerId: string): void {
  socket.emit('cast_vote', votedPlayerId);

  // Update status
  const statusMessage = document.getElementById('status-message');
  if (statusMessage) {
    statusMessage.textContent = 'Vote cast! Waiting for results...';
  }
}
