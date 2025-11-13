<img src="https://github.com/user-attachments/assets/41480939-e340-4370-9e21-510f58ac29cb" width="200" height="200">

# AmongHumans

**A Real-Time Multiplayer Social Deduction Game**

**Play now: [Coming Soon - AWS App Runner Deployment]**

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
    * **AI Identification:** Humans who correctly vote for the AI score points (+2).
    * **Human Deception:** Humans receive +1 point for each vote they receive from other humans.
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
*   **AI:** AWS Bedrock (openai.gpt-oss-120b-1:0 model via OpenAI-compatible API)
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
4.  **Configure AWS Bedrock:**

    **Step 1: Generate a Bedrock API Key**
    *   Open the [AWS Bedrock Console](https://console.aws.amazon.com/bedrock/)
    *   Navigate to "API Keys" in the left sidebar
    *   Click "Create API Key"
    *   Choose either:
        *   **Long-term key** (30 days) - Good for testing and development
        *   **Short-term key** (up to 12 hours) - Recommended for production
    *   Save the generated API key securely (it won't be shown again!)

    **Step 2: Add Configuration to `.env`**
    ```dotenv
    # Required for the AI player functionality
    BEDROCK_API_KEY=your_bedrock_api_key_here
    AWS_REGION=us-west-2
    ```

    *   **Important:** Ensure the `.env` file is added to your `.gitignore` file to avoid committing your API key!
    *   **Note:** Your AWS account must have access to the `openai.gpt-oss-120b-1:0` model in AWS Bedrock.
    *   **Security:** Consider using short-term keys for production deployments
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

## Deployment

### AWS App Runner (Recommended)

This application is configured for deployment on AWS App Runner, which provides native WebSocket support required for Socket.IO real-time communication.

**Prerequisites:**
- AWS Account
- AWS CLI installed and configured
- Docker installed (for local testing)

**Deployment Options:**

#### Deploy via AWS Console (Easiest)

1. **Push your code to GitHub**
   ```bash
   git add .
   git commit -m "Add AWS App Runner configuration"
   git push origin main
   ```

2. **Create App Runner Service**
   - Go to [AWS App Runner Console](https://console.aws.amazon.com/apprunner/)
   - Click "Create service"
   - Choose "Source code repository" and connect to your GitHub repo
   - Select the repository and branch (main)
   - Build settings: Choose "Use a configuration file" and specify `apprunner.yaml`
   - Or manually configure:
     - Runtime: Node.js 18
     - Build command: `npm install -g pnpm && pnpm install && pnpm run build:server && pnpm run build:client`
     - Start command: `pnpm start`
     - Port: 3000

3. **Configure Environment Variables**
   - In the service configuration, add:
     - `BEDROCK_API_KEY`: Your AWS Bedrock API key
     - `AWS_REGION`: Your AWS region (e.g., us-west-2)
     - `NODE_ENV`: production

4. **Deploy**
   - Click "Create & deploy"
   - Wait for deployment to complete (~5-10 minutes)
   - Access your app at the provided App Runner URL

#### Local Testing with Docker

Before deploying, test the Docker build locally:

```bash
# Build the image
docker build -t among-humans .

# Run the container
docker run -p 3000:3000 \
  -e BEDROCK_API_KEY=your_key_here \
  -e AWS_REGION=us-west-2 \
  -e NODE_ENV=production \
  among-humans

# Access at http://localhost:3000
```

### Deployment Costs

AWS App Runner pricing (approximate):
- **Provisioned**: $0.064/hour (~$46/month) + $0.064/GB per month
- **Active usage**: Additional charges for request processing
- **Free tier**: 360 vCPU-hours and 720 GB-hours per month

### Alternative Deployment Options

While this project is optimized for AWS App Runner, you can also deploy to:
- **AWS Elastic Beanstalk**: Traditional PaaS with more configuration options
- **AWS ECS Fargate**: Container orchestration with more control
- **AWS EC2**: Full control but more management overhead

**Note:** AWS Amplify Hosting is **not recommended** as it doesn't support WebSocket connections required for Socket.IO.

## Planned Enhancements

*   More sophisticated AI response generation strategies
*   Additional game modes and settings
*   Persistent player profiles and statistics
*   Enhanced mobile experience
*   Expanded set of pre-generated question prompts
*   Admin controls for game hosts
*   More detailed analytics on player performance
