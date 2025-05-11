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
  isReady?: boolean;
}

interface PublicAnswer {
  name: string;
  answer: string;
  time?: number;
}

interface VoteData {
  participants: Record<string, Player>;
  aiPlayer: Player;
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
  isReconnection?: boolean;
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
let playerVotesReceived: Record<string, number> = {}; // Track votes received by each player
const currentPlayers: Record<string, Player> = {}; // Store current players to look up player IDs

// Track player colors for the current room
const playerColors: Record<string, string> = {};

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

// Declare io to avoid TypeScript error
declare const io: () => Socket;

// Function to get URL parameters
function getUrlParameter(name: string): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

// Function to update URL with room code and player name
function updateUrlWithRoomCode(roomCode: string, playerName?: string): void {
  // Create a new URL object based on the current URL
  const url = new URL(window.location.href);

  // Set the room parameter
  url.searchParams.set('room', roomCode);

  // If player name is provided, add it to the URL
  if (playerName) {
    url.searchParams.set('player', playerName);
  }

  // Update the URL without reloading the page
  window.history.pushState({}, '', url.toString());

  console.log(
    `URL updated with room code: ${roomCode}${playerName ? ` and player name: ${playerName}` : ''}`,
  );
}

// Function to clear room code and player name from URL
function clearRoomCodeFromUrl(): void {
  // Create a new URL object based on the current URL
  const url = new URL(window.location.href);

  // Remove the room and player parameters
  url.searchParams.delete('room');
  url.searchParams.delete('player');

  // Update the URL without reloading the page
  window.history.pushState({}, '', url.toString());

  console.log('Room code and player name cleared from URL');
}

// Connect to server when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Initialize socket connection
  socket = io();

  // Handle connection event
  socket.on('connect', () => {
    console.log('Connected to server');
    myPlayerId = socket.id;

    // Make sure status message is visible
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.classList.remove('hidden');
      statusMessage.textContent = 'Create a new room or join an existing one!';
    }

    // Check if room code and player name are in URL parameters
    const roomCode = getUrlParameter('room');
    const playerName = getUrlParameter('player');

    if (roomCode) {
      console.log(
        `Found room code in URL: ${roomCode}${playerName ? `, player name: ${playerName}` : ''}`,
      );

      // Attempt to join the room with player name if available (for reconnection)
      if (playerName) {
        socket.emit('join_room', { roomCode, playerName });
      } else {
        // Just use room code for a fresh join
        socket.emit('join_room', roomCode);
      }

      // Also update the input field in case the join fails and we need to show the UI
      const roomCodeInput = document.getElementById('room-code-input') as HTMLInputElement;
      if (roomCodeInput) {
        roomCodeInput.value = roomCode;
      }
    }
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

    // Hide GitHub link when creating a room
    const githubLink = document.getElementById('github-link');
    if (githubLink) {
      githubLink.classList.add('hidden');
    }
  });

  // Handle room joined event
  socket.on('room_joined', (data: RoomData & { isReconnection?: boolean }) => {
    // Reset color assignments for the new room
    resetColorAssignments();

    handleRoomJoined(data);

    // Show success message
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      if (data.isReconnection) {
        statusMessage.textContent = 'Successfully reconnected to room!';
      } else {
        statusMessage.textContent = 'Room joined! Waiting for the game to start...';
      }
    }

    // Hide GitHub link when joining a room
    const githubLink = document.getElementById('github-link');
    if (githubLink) {
      githubLink.classList.add('hidden');
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

    // Clear room code from URL if it exists in the query parameters
    const roomCode = getUrlParameter('room');
    if (roomCode) {
      clearRoomCodeFromUrl();

      // Also clear the room code input field
      const roomCodeInput = document.getElementById('room-code-input') as HTMLInputElement;
      if (roomCodeInput) {
        roomCodeInput.value = '';
      }
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
      // Filter out AI players from the count
      const humanPlayerCount = Object.values(serverPlayers).filter((player) => !player.isAI).length;
      updatePlayerCount(humanPlayerCount);
    }
  });

  // Handle showing UI configuration to all players
  socket.on('show_config_ui', (data: { isFirstGame: boolean }) => {
    const startButton = document.getElementById('start-round-button') as HTMLButtonElement;
    const roundConfig = document.getElementById('round-config');
    const exitRoomButton = document.getElementById('exit-room-button');

    // Show the exit room button again during setup phase
    if (exitRoomButton) {
      exitRoomButton.classList.remove('hidden');
    }

    if (startButton && roundConfig) {
      // Set the appropriate button text based on the game state
      if (data?.isFirstGame) {
        startButton.textContent = 'Ready?';
        // Show round configuration at the start of the game
        roundConfig.classList.remove('hidden');
      } else {
        startButton.textContent = 'Start Next Round';
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
   * Helper function to set up a game phase
   * @param message Status message to show
   */
  function setGamePhase(message: string): void {
    // Update status message with the current game phase
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = message;
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

      // Exit room button remains visible during gameplay

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

      // Check if this is a normal challenge or a reconnection
      const isReconnection = data.duration === 0;

      // Show and enable the input and submit button
      const answerInput = document.getElementById('answer-input') as HTMLTextAreaElement;
      const submitButton = document.getElementById('submit-answer-button') as HTMLButtonElement;

      if (answerInput && submitButton) {
        // Always make elements visible
        answerInput.classList.remove('hidden');
        submitButton.classList.remove('hidden');

        if (!isReconnection) {
          // Normal challenge - enable input and clear value
          answerInput.value = '';
          answerInput.disabled = false;
          submitButton.disabled = false;
        } else {
          // For reconnection, we'll initially enable the input
          // The server will tell us if we've already answered via status_update event
          answerInput.disabled = false;
          submitButton.disabled = false;

          // Don't clear existing value on reconnection
        }
      }

      // Only clear previous results for new challenges (not reconnections)
      if (!isReconnection) {
        clearElementContent('public-answers-area');
        clearElementContent('voting-area');

        // Set up the challenge phase with timer if it's a new challenge
        setGamePhase('Answer the question when ready.');
      }
    },
  );

  // Handle status update event
  socket.on('status_update', (message: string) => {
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = message;
    }

    // Handle special status messages for reconnection cases
    if (message === 'You already submitted an answer. Waiting for others...') {
      // Disable answer input since this player has already answered
      const answerInput = document.getElementById('answer-input') as HTMLTextAreaElement;
      const submitButton = document.getElementById('submit-answer-button') as HTMLButtonElement;

      if (answerInput && submitButton) {
        answerInput.disabled = true;
        submitButton.disabled = true;
        submitButton.classList.add('hidden');
      }
    } else if (message === 'Vote cast! Waiting for results...') {
      // When reconnecting during voting phase, ensure we show the player has already voted
      const answerCards = document.querySelectorAll('.answer-card');
      for (const card of Array.from(answerCards)) {
        card.classList.remove('vote-enabled');
        (card as HTMLElement).style.cursor = 'default';
      }
    }
  });

  // Handle restore vote selection event (for reconnection)
  socket.on('restore_vote_selection', (data: { votedPlayerId: string; playerName: string }) => {
    const { votedPlayerId, playerName } = data;

    // Find the answer card that this player voted for and mark it as selected
    const answerCards = document.querySelectorAll('.answer-card');
    for (const card of Array.from(answerCards)) {
      const cardPlayerName = (card as HTMLElement).dataset.playerName;

      // If this is the card the player voted for
      if (cardPlayerName === playerName) {
        // Add selected-answer class to highlight it
        card.classList.add('selected-answer');

        // Remove vote-enabled class and disable cursor to prevent re-voting
        card.classList.remove('vote-enabled');
        (card as HTMLElement).style.cursor = 'default';
      } else {
        // Make sure all other cards are not selectable
        card.classList.remove('vote-enabled');
        (card as HTMLElement).style.cursor = 'default';
      }
    }

    console.log(`Restored vote selection for player ${playerName} (${votedPlayerId})`);
  });

  // Handle update vote statistics event (for reconnection)
  socket.on('update_vote_statistics', (data: { playerVotesReceived: Record<string, number> }) => {
    // Update global player votes received with the server data
    playerVotesReceived = data.playerVotesReceived || {};

    // Update the player list to reflect vote counts
    renderPlayerList(currentPlayers);

    console.log('Updated vote statistics from server:', playerVotesReceived);
  });

  // Handle public answers event
  socket.on('show_public_answers', (publicAnswers: PublicAnswer[]) => {
    // Update game state to show answers

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
          <div>${answer.answer || '<em class="text-gray-400">(No answer provided)</em>'}</div>
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
          background-color: #ff8cb4 !important; /* Bright pink background for more contrast */
          border-color: #ff4d94 !important; /* Darker pink border */
          border-width: 3px !important; /* Thicker border */
          box-shadow: 0 0 10px rgba(255, 140, 180, 0.5) !important; /* Add glow effect */
          transform: translateY(-2px) !important; /* Slight lift effect */
          position: relative !important;
        }
        .selected-answer::after {
          content: "✓ Your vote" !important;
          position: absolute !important;
          top: -10px !important;
          right: 10px !important;
          background-color: #ff4d94 !important;
          color: white !important;
          padding: 3px 8px !important;
          border-radius: 10px !important;
          font-size: 12px !important;
          font-weight: bold !important;
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
    // Store participants for looking up player IDs
    Object.assign(currentPlayers, data.participants);

    // Set up the voting phase
    setGamePhase('Click on an answer to vote for who you think is the AI!');

    // We vote by clicking on answers, so we don't need to show the voting area
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
    // Prepare for showing vote results

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
        waitingMessage.innerHTML =
          '<- Click "Start Next Round" when you\'re ready to continue! Any player can start the next round.';
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
          // Clear room code from URL before reloading
          clearRoomCodeFromUrl();
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

    // Scoring explanation section removed as requested

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

    // Show individual player instructions
    if (playerImposterPrompts && Object.keys(playerImposterPrompts).length > 0) {
      const playerPromptSection = document.createElement('div');
      playerPromptSection.className = 'mt-4';

      const playerPromptTitle = document.createElement('h4');
      playerPromptTitle.className = 'font-semibold mb-2';
      playerPromptTitle.textContent = 'Individual Player Instructions:';
      playerPromptSection.appendChild(playerPromptTitle);

      const playerPromptContent = document.createElement('div');
      playerPromptContent.className = 'space-y-2';

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
          <span class="text-gray-500 text-sm">▲</span>
        `;
        roundPanel.appendChild(roundHeader);

        // Create content (expanded by default)
        const roundContent = document.createElement('div');
        roundContent.className = 'p-4 bg-white';

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
          };

          // Sort answers by player name for consistent display
          const sortedAnswers = Object.values(historyItem.answers)
            .map((answer) => {
              const typedAnswer = answer as AnswerType;
              return {
                playerName: players[typedAnswer.playerId]?.name || 'Unknown Player',
                isAI: typedAnswer.playerId === aiPlayer.id,
                answer: typedAnswer.answer,
                playerId: typedAnswer.playerId,
              };
            })
            .sort((a, b) => a.playerName.localeCompare(b.playerName));

          for (const answerData of sortedAnswers) {
            const answerItem = document.createElement('div');
            answerItem.className = 'p-2 border border-gray-200 rounded bg-gray-50';

            // Highlight AI answers
            if (answerData.isAI) {
              answerItem.classList.add('bg-red-50', 'border-red-200');
            }

            answerItem.innerHTML = `
              <div class="mb-1">
                <span class="font-semibold ${answerData.isAI ? 'text-red-600' : ''}">${answerData.playerName}${answerData.isAI ? ' (AI)' : ''}</span>
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
          const isVisible = !roundContent.classList.contains('hidden');
          roundContent.classList.toggle('hidden', isVisible);
          const arrow = roundHeader.querySelector('span:last-child');
          if (arrow) {
            arrow.textContent = isVisible ? '▼' : '▲';
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

  // Update URL with room code and player name for reconnection
  updateUrlWithRoomCode(roomCode, player.name);

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

    // Add click-to-copy functionality to copy just the room code
    roomCodeDisplay.addEventListener('click', async () => {
      try {
        // Copy just the room code itself
        await navigator.clipboard.writeText(roomCode);

        // Store original content before changing it
        const originalContent = roomCodeDisplay.textContent;

        // Show temporary success feedback
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

  // Exit room button click handler
  const exitRoomButton = document.getElementById('exit-room-button');
  if (exitRoomButton) {
    exitRoomButton.addEventListener('click', () => {
      // Only leave the room if we're actually in one
      if (myRoomCode) {
        // Leave socket.io room
        socket.emit('leave_room');

        // Clear room code
        myRoomCode = '';

        // Clear URL parameters
        clearRoomCodeFromUrl();

        // Hide room info area
        const roomInfoArea = document.getElementById('room-info-area');
        if (roomInfoArea) {
          roomInfoArea.classList.add('hidden');
        }

        // Hide game grid
        const gameGrid = document.getElementById('game-grid');
        if (gameGrid) {
          gameGrid.classList.add('hidden');
        }

        // Show room selection and game description
        const roomSelectionArea = document.getElementById('room-selection-area');
        const gameDescription = document.getElementById('game-description');

        if (roomSelectionArea) {
          roomSelectionArea.classList.remove('hidden');
        }

        if (gameDescription) {
          gameDescription.classList.remove('hidden');
        }

        // Reset input fields for a fresh experience when creating a new room
        // Reset and re-enable AI imposter prompt input
        const aiImposterPrompt = document.getElementById(
          'ai-imposter-prompt',
        ) as HTMLTextAreaElement;
        const submitImposterPromptButton = document.getElementById(
          'submit-imposter-prompt',
        ) as HTMLButtonElement;
        if (aiImposterPrompt && submitImposterPromptButton) {
          aiImposterPrompt.value = '';
          aiImposterPrompt.disabled = false;
          submitImposterPromptButton.disabled = false;
          submitImposterPromptButton.classList.remove('opacity-50');
          submitImposterPromptButton.textContent = 'Submit Your Influence';

          // Remove any previously added note about submission
          const promptContainer = aiImposterPrompt.closest('div');
          if (promptContainer?.parentNode) {
            const existingNote = promptContainer.parentNode.querySelector('.text-green-600');
            if (existingNote) {
              existingNote.remove();
            }
          }
        }

        // Reset and re-enable custom question input
        const customQuestionInput = document.getElementById(
          'custom-question-input',
        ) as HTMLTextAreaElement;
        const submitCustomQuestionButton = document.getElementById(
          'submit-custom-question',
        ) as HTMLButtonElement;
        if (customQuestionInput && submitCustomQuestionButton) {
          customQuestionInput.value = '';
          customQuestionInput.disabled = false;
          submitCustomQuestionButton.disabled = false;
          submitCustomQuestionButton.classList.remove('opacity-50');
          submitCustomQuestionButton.textContent = 'Submit Topic Ideas';

          // Remove any previously added note about submission
          const questionContainer = customQuestionInput.closest('div');
          if (questionContainer?.parentNode) {
            const existingNote = questionContainer.parentNode.querySelector('.text-green-600');
            if (existingNote) {
              existingNote.remove();
            }
          }
        }

        // Update status message
        const statusMessage = document.getElementById('status-message');
        if (statusMessage) {
          statusMessage.textContent =
            'You have left the room. Create a new room or join an existing one!';
        }

        // Show GitHub link again when exiting a room
        const githubLink = document.getElementById('github-link');
        if (githubLink) {
          githubLink.classList.remove('hidden');
        }
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

  // Ready/Start button click handler
  const startRoundButton = document.getElementById('start-round-button') as HTMLButtonElement;
  if (startRoundButton) {
    startRoundButton.addEventListener('click', () => {
      // Get current player
      const currentPlayer = myPlayerId ? currentPlayers[myPlayerId] : null;

      if (!currentPlayer) return;

      // Check if this is first game or between rounds
      // Between rounds: button text will be "Start Next Round"
      // First game: button text will be "Ready?" or "Ready ✓"
      const isBetweenRounds = startRoundButton.textContent === 'Start Next Round';

      if (isBetweenRounds) {
        // Between rounds - any player can start the next round
        socket.emit('request_start_round');

        // Show loading state
        startRoundButton.innerHTML =
          '<span class="animate-spin inline-block mr-2">⟳</span> Loading...';
        startRoundButton.disabled = true;
        startRoundButton.classList.add('opacity-75');
      } else {
        // First game - use the ready system
        // Toggle ready state
        const isReady = !currentPlayer.isReady;

        // Update button text based on ready state
        if (isReady) {
          startRoundButton.textContent = 'Ready ✓';
          startRoundButton.classList.add('opacity-75');
        } else {
          startRoundButton.textContent = 'Ready?';
          startRoundButton.classList.remove('opacity-75');
        }

        // Notify server about ready status change
        socket.emit('player_ready', isReady);
      }
    });
  }

  // Submit answer button click handler
  const submitAnswerButton = document.getElementById('submit-answer-button');
  if (submitAnswerButton) {
    submitAnswerButton.addEventListener('click', () => {
      const answerInput = document.getElementById('answer-input') as HTMLTextAreaElement;
      const answer = answerInput.value; // Don't trim to preserve partial answers

      // Prevent empty answer submission
      if (!answer.trim()) {
        // Flash the input field with a red border to indicate error
        answerInput.classList.add('error-border');
        setTimeout(() => {
          answerInput.classList.remove('error-border');
        }, 1000);

        // Update status to show error
        const statusMessage = document.getElementById('status-message');
        if (statusMessage) {
          statusMessage.textContent = 'Please enter an answer before submitting.';
        }
        return;
      }

      // Emit answer to server
      socket.emit('submit_answer', {
        answer,
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

// Game phase transition code

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

  // Track game state - we're in waiting state if prompt area is empty
  // This ensures player list appears as soon as a challenge starts
  const promptArea = document.getElementById('prompt-area');
  const isWaiting = !promptArea?.textContent;

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

    // Add player name span with ready status
    const nameSpan = document.createElement('div');
    nameSpan.style.display = 'flex';
    nameSpan.style.flexDirection = 'column';

    // Player name with "you" indicator if applicable
    const nameText = document.createElement('span');
    nameText.innerHTML = `${player.name}${player.id === myPlayerId ? ' <span style="color: #2563eb;">(you)</span>' : ''}`;
    nameSpan.appendChild(nameText);

    // Ready status indicator (only show in waiting state)
    if (isWaiting) {
      const readyStatus = document.createElement('span');
      readyStatus.style.fontSize = '0.75rem';

      if (player.isReady) {
        readyStatus.style.color = '#10b981'; // Green for ready
        readyStatus.textContent = 'Ready';
      } else {
        readyStatus.style.color = '#f59e0b'; // Amber for not ready
        readyStatus.textContent = 'Not ready';
      }

      nameSpan.appendChild(readyStatus);
    }

    // Create right side container (votes or ready indicator)
    const rightDiv = document.createElement('div');
    rightDiv.style.display = 'flex';
    rightDiv.style.flexDirection = 'row';
    rightDiv.style.alignItems = 'center';

    if (isWaiting) {
      // Ready status indicator (visual)
      const readyIndicator = document.createElement('span');
      readyIndicator.style.width = '1rem';
      readyIndicator.style.height = '1rem';
      readyIndicator.style.borderRadius = '9999px';
      readyIndicator.style.backgroundColor = player.isReady ? '#10b981' : '#f59e0b'; // Green if ready, amber if not

      rightDiv.appendChild(readyIndicator);
    } else {
      // Vote counter during game
      const voteCounterSpan = document.createElement('span');
      voteCounterSpan.style.backgroundColor = '#a5b4fc';
      voteCounterSpan.style.color = 'white';
      voteCounterSpan.style.borderRadius = '9999px';
      voteCounterSpan.style.padding = '0.25rem 0.75rem';
      voteCounterSpan.style.fontSize = '0.875rem';
      voteCounterSpan.style.fontWeight = '600';
      voteCounterSpan.textContent = voteCount.toString();

      rightDiv.appendChild(voteCounterSpan);
    }

    // Assemble the player item
    playerInfoDiv.appendChild(avatarDiv);
    playerInfoDiv.appendChild(nameSpan);

    playerItem.appendChild(playerInfoDiv);
    playerItem.appendChild(rightDiv);

    // Add to player list
    playerList.appendChild(playerItem);

    // Log successful creation
    console.log(`[COLOR_DEBUG] Created avatar for ${player.name} with color ${playerColor}`);
  }
}

// Update player count display
function updatePlayerCount(count: number): void {
  const playerCountElement = document.getElementById('player-count');
  const playerLabelElement = document.querySelector('.player-counter span:last-child');

  if (playerCountElement) {
    playerCountElement.textContent = count.toString();
  }

  // Update the label to show "player" or "players" based on count
  if (playerLabelElement) {
    playerLabelElement.textContent = count === 1 ? 'player' : 'players';
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
