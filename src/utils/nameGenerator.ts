export const playerNames = [
  'Alex',
  'Bailey',
  'Casey',
  'Dana',
  'Ellis',
  'Finley',
  'Gray',
  'Harper',
  'Indigo',
  'Jordan',
  'Kennedy',
  'Logan',
  'Morgan',
  'Nico',
  'Parker',
  'Quinn',
  'Riley',
  'Sage',
  'Taylor',
  'Avery',
  'Blake',
  'Charlie',
  'Drew',
  'Echo',
  'Frankie',
  'Hayden',
  'Jamie',
  'Kai',
  'Lane',
  'Max',
  'Nova',
  'Oakley',
  'Phoenix',
  'Reese',
  'Sydney',
  'Tatum',
  'Val',
  'Winter',
  'Zephyr',
  'Ash',
  'Brook',
  'Cameron',
  'Delta',
  'Emery',
  'Jaden',
  'Kendall',
  'Marlowe',
  'Rory',
  'Skyler',
  'Tristan',
  'Robin',
  'River',
  'Spencer',
  'Justice',
  'Wren',
  'Storm',
  'Shawn',
  'Rowan',
  'Remy',
  'Piper',
  'Monroe',
  'Jules',
  'Juno',
  'Haven',
];

/**
 * Get a random unique player name that hasn't been used in the room
 * @param roomUsedNames Array of names already used in this room
 * @returns A unique player name for the room
 */
export function getRandomPlayerName(roomUsedNames: string[]): string {
  // Filter out already used names
  const availableNames = playerNames.filter((name) => !roomUsedNames.includes(name));

  // If we've used all names, create a unique name with numeric suffix
  if (availableNames.length === 0) {
    // Get a random name from the full list and add a random number suffix
    const randomName = playerNames[Math.floor(Math.random() * playerNames.length)];
    const uniqueName = `${randomName}${Math.floor(Math.random() * 100)}`;

    // Add to the used names list
    roomUsedNames.push(uniqueName);
    return uniqueName;
  }

  // Get a random name from available names
  const randomIndex = Math.floor(Math.random() * availableNames.length);
  const selectedName = availableNames[randomIndex];

  // Add to the used names list
  roomUsedNames.push(selectedName);

  return selectedName;
}

/**
 * Generate a batch of unique names for a room
 * @param count Number of names to generate
 * @param roomUsedNames Array of names already used in this room (will be modified)
 * @returns Array of unique player names
 */
export function generateUniqueNames(count: number, roomUsedNames: string[] = []): string[] {
  const names: string[] = [];

  for (let i = 0; i < count; i++) {
    names.push(getRandomPlayerName(roomUsedNames));
  }

  return names;
}
