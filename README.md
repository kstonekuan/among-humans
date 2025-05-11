# AmongHumans

**A Real-Time Multiplayer Social Deduction Game**

**Play now: [https://among-humans.onrender.com/](https://among-humans.onrender.com/)**

---

## Overview

AmongHumans is a web-based multiplayer game where human players interact in a chat-like environment to identify a hidden AI player ("Imposter") among them. Players submit text answers to creative prompts each round. What makes it unique:

1.  **Player-Influenced AI:** Players can submit instructions to influence how the AI behaves, making each game unique and challenging.
2.  **Dynamic AI Player:** The AI opponent generates its answers using an LLM, gets a "vibe-based" name to blend in, and votes strategically based on heuristics.
3.  **Dual-Objective Gameplay:** While the main goal is to catch the AI, human players can *also* win rounds by successfully deceiving others into voting for *them* as the AI!

Can you outsmart the AI player? Or can you fool everyone into thinking *you're* the machine?

## Gameplay Loop

1.  **Join:** Players connect via their browser and join a room with a shareable code.
2.  **Game Configuration:**
    * Players set the number of rounds for the game (1-10)
    * Players can submit instructions to influence the AI's behavior
    * Players can suggest question topics for the game
3.  **AI Activation:** The server activates the AI player ("Imposter") with a name designed to blend in with the human players.
4.  **Game Rounds:**
    * **Prompt:** A text-based prompt appears for all players (e.g., "Describe your perfect Sunday").
    * **Answering:** Players submit their answers within a time limit.
    * **Voting:** All answers are displayed (anonymously), and players vote for who they think is the AI.
5.  **Results & Scoring:**
    * **AI Caught:** If the AI receives the most votes, humans who voted correctly score points (+2).
    * **Human Deception:** If a human receives the most votes, that player scores points (+3) for successful deception, and the AI scores (+1) for surviving.
    * **AI Survives:** In other cases (e.g., tie among humans), the AI scores (+1) for surviving.
6.  **Final Results:** At the end of all rounds, the game reveals the AI's identity and shows detailed statistics about detection success, player scores, and influence instructions.

## Key Features

*   **Real-Time Multiplayer:** Uses Socket.IO for seamless interaction between players with instant updates.
*   **Player Room System:** Create private game rooms with shareable codes for friends to join.
*   **Dynamic AI Player:**
    *   **Player-Influenced Behavior:** Each player can submit instructions on how the AI should behave.
    *   **Adaptive Responses:** AI analyzes human answers and adapts its style to blend in better.
    *   **Smart Naming:** AI gets a name that fits stylistically with the human players' names.
    *   **Strategic Voting:** AI employs multiple strategies to vote for human players.
*   **Reconnection Support:** Players can rejoin active games if they get disconnected.
*   **Detailed Game History:** Complete round-by-round history of questions, answers, and voting patterns.
*   **Dual-Goal Social Deduction:** Balance finding the AI with the possibility of winning through deception.
*   **Player-Generated Questions:** Suggest topics for the game to create custom question prompts.

## Tech Stack

Note: This codebase was largely generated with [Claude Code](https://www.anthropic.com/claude-code) 

*   **Backend:** Node.js, Express.js, TypeScript
*   **Real-time Communication:** Socket.IO
*   **Frontend:** HTML5, Tailwind CSS 4.x, TypeScript
*   **AI:** OpenAI API (gpt-4.1-mini model)
*   **Environment Variables:** `dotenv`
*   **Code Quality:** Biome (linting and formatting)

## Setup & Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/among-humans-io.git
    cd among-humans-io
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Create Environment File:**
    Create a file named `.env` in the project root.
4.  **Add API Key:**
    Add your OpenAI API key to the `.env` file:
    ```dotenv
    # Required for the AI player functionality
    OPENAI_API_KEY=your_api_key_here
    ```
    *   **Important:** Ensure the `.env` file is added to your `.gitignore` file to avoid committing your secret key!
5.  **Ensure `.gitignore`:** Verify that `.env` and `node_modules/` are listed in your `.gitignore` file.

## Running the Project

1.  **Build the project:**
    ```bash
    npm run build
    ```
2.  **Start the server:**
    ```bash
    npm start
    ```
3.  **Access the game:**
    Open your web browser and navigate to `http://localhost:3000` (or the port specified in `server.ts`).
4.  **Invite friends or simulate multiple players:**
    * Share your room code with friends to play together
    * Or open multiple browser tabs/windows pointing to the same address to simulate multiple players

## Project Status

This project is an actively developed social deduction game with the following features implemented:
*   Complete game loop with room management, player reconnection, and round tracking
*   Player-influenced AI behavior system
*   Dynamic question generation based on player suggestions
*   Detailed game statistics and history
*   Scoring system rewarding both detection and deception
*   Mobile-responsive UI

## Recent Updates

* Added reconnection support to allow players to rejoin active games
* Improved player count display (excluding AI players)
* Enhanced round history tracking and statistics
* Added URL-based navigation with room codes and player names
* Implemented more robust error handling
* Added visual feedback for game actions (votes, submissions, etc.)
* Added exit room functionality

## Planned Enhancements

*   More sophisticated AI response generation strategies
*   Additional game modes and settings
*   Persistent player profiles and statistics
*   Enhanced mobile experience
*   Expanded set of pre-generated question prompts
*   Admin controls for game hosts
*   More detailed analytics on player performance
