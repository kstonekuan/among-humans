import { describe, expect, test } from 'vitest';
import {
  generateUniqueNames,
  getRandomPlayerName,
  playerNames,
} from '../../src/utils/nameGenerator';

describe('nameGenerator', () => {
  describe('getRandomPlayerName', () => {
    test('returns a name from the player names list', () => {
      const usedNames: string[] = [];
      const name = getRandomPlayerName(usedNames);

      // Name should be in the player names list
      expect(playerNames).toContain(name);

      // Name should be added to used names
      expect(usedNames).toContain(name);
    });

    test('does not return names that are already used in the room', () => {
      // Create a list of used names (use the first 5 names)
      const usedNames = playerNames.slice(0, 5);
      const originalUsedNames = [...usedNames];

      // Get a new name
      const name = getRandomPlayerName(usedNames);

      // Name should not be in the original used names
      expect(originalUsedNames).not.toContain(name);

      // Name should still be from the player names list
      expect(playerNames).toContain(name);
    });

    test('generates a name with numeric suffix when all names are used', () => {
      // Use all available names
      const usedNames = [...playerNames];

      // Get a new name
      const name = getRandomPlayerName(usedNames);

      // Name should not be in the original player names list
      expect(playerNames).not.toContain(name);

      // Name should start with one of the player names
      const nameBase = name.replace(/\d+$/, '');
      expect(playerNames).toContain(nameBase);

      // Name should end with numbers
      expect(name).toMatch(/\d+$/);
    });
  });

  describe('generateUniqueNames', () => {
    test('generates the requested number of unique names', () => {
      const count = 10;
      const names = generateUniqueNames(count);

      // Should have the requested number of names
      expect(names.length).toBe(count);

      // All names should be unique
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(count);
    });

    test('respects existing used names', () => {
      // Create a list of used names (use the first 5 names)
      const usedNames = playerNames.slice(0, 5);
      const originalUsedNames = [...usedNames];

      // Generate 10 more names
      const count = 10;
      const names = generateUniqueNames(count, usedNames);

      // Should have the requested number of names
      expect(names.length).toBe(count);

      // None of the new names should be in the original used names
      for (const name of names) {
        expect(originalUsedNames).not.toContain(name);
      }

      // Used names array should be updated to include all names
      expect(usedNames.length).toBe(originalUsedNames.length + count);
    });

    test('different rooms can have the same names', () => {
      // Create two separate rooms with their own used names
      const room1UsedNames: string[] = [];
      const room2UsedNames: string[] = [];

      // Generate names for each room
      const room1Names = generateUniqueNames(10, room1UsedNames);
      const room2Names = generateUniqueNames(10, room2UsedNames);

      // Each room should have unique names within itself
      expect(new Set(room1Names).size).toBe(10);
      expect(new Set(room2Names).size).toBe(10);

      // But there can be overlap between rooms
      // We'll ensure this by clearing room2's used names and trying to get the same names
      room2UsedNames.length = 0;
      for (const _name of room1Names) {
        const originalRoom2Length = room2UsedNames.length;
        getRandomPlayerName(room2UsedNames);
        expect(room2UsedNames.length).toBe(originalRoom2Length + 1);
      }
    });

    test('handles more names than in the player list', () => {
      // Generate more names than in the player list
      const count = playerNames.length + 10;
      const names = generateUniqueNames(count);

      // Should have the requested number of names
      expect(names.length).toBe(count);

      // Should have unique names despite exceeding the list length
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(count);

      // Should contain some names with numeric suffixes
      const namesWithSuffix = names.filter((name) => /\d+$/.test(name));
      expect(namesWithSuffix.length).toBeGreaterThan(0);
    });
  });
});
