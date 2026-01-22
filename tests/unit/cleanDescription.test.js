/**
 * Unit tests for cleanDescription utility
 * Tests the function which strips chapter listings from descriptions
 */

const { cleanDescription } = require('../../server/utils/cleanDescription');

describe('cleanDescription', () => {
  test('returns empty string for null input', () => {
    expect(cleanDescription(null)).toBe('');
  });

  test('returns empty string for undefined input', () => {
    expect(cleanDescription(undefined)).toBe('');
  });

  test('returns empty string for empty string input', () => {
    expect(cleanDescription('')).toBe('');
  });

  test('strips HTML tags', () => {
    const input = '<p>This is a <strong>test</strong> description.</p>';
    const result = cleanDescription(input);
    expect(result).toBe('This is a test description.');
  });

  test('decodes HTML entities - nbsp', () => {
    const input = 'Hello&nbsp;World';
    const result = cleanDescription(input);
    expect(result).toBe('Hello World');
  });

  test('decodes HTML entities - amp', () => {
    const input = 'Tom &amp; Jerry';
    const result = cleanDescription(input);
    expect(result).toBe('Tom & Jerry');
  });

  test('decodes HTML entities - lt and gt', () => {
    const input = 'Number &lt; Ten &gt; Five';
    const result = cleanDescription(input);
    expect(result).toBe('Number < Ten > Five');
  });

  test('decodes HTML entities - quotes', () => {
    const input = '&quot;Hello&quot; and &#39;World&#39; and &apos;Test&apos;';
    const result = cleanDescription(input);
    expect(result).toBe('"Hello" and \'World\' and \'Test\'');
  });

  test('decodes numeric HTML entities', () => {
    const input = '&#65;&#66;&#67;'; // ABC
    const result = cleanDescription(input);
    expect(result).toBe('ABC');
  });

  test('decodes hex HTML entities', () => {
    const input = '&#x41;&#x42;&#x43;'; // ABC
    const result = cleanDescription(input);
    expect(result).toBe('ABC');
  });

  test('normalizes multiple whitespaces', () => {
    const input = 'Hello    World\n\n\nTest   Content';
    const result = cleanDescription(input);
    expect(result).toBe('Hello World Test Content');
  });

  test('extracts description after End Credits', () => {
    const input = 'Chapter 1 Chapter 2 End Credits This is the actual description of the book that is more than fifty characters long.';
    const result = cleanDescription(input);
    expect(result).toBe('This is the actual description of the book that is more than fifty characters long.');
  });

  test('extracts description after Epilogue', () => {
    const input = 'Chapter 1 Epilogue A fantastic story about adventure and mystery that spans over fifty characters for sure.';
    const result = cleanDescription(input);
    expect(result).toBe('A fantastic story about adventure and mystery that spans over fifty characters for sure.');
  });

  test('extracts description after About the Author', () => {
    const input = 'Track 1 Track 2 About the Author This wonderful audiobook tells the tale of a brave hero who must save the world.';
    const result = cleanDescription(input);
    expect(result).toBe('This wonderful audiobook tells the tale of a brave hero who must save the world.');
  });

  test('removes Opening Credits from start', () => {
    const input = 'Opening Credits This is a great story.';
    const result = cleanDescription(input);
    expect(result).toBe('This is a great story.');
  });

  test('removes End Credits from end', () => {
    const input = 'This is a great story. End Credits';
    const result = cleanDescription(input);
    expect(result).toBe('This is a great story.');
  });

  test('removes Chapter One Chapter Two pattern', () => {
    const input = 'Chapter One Chapter Two Chapter Three This is the real description.';
    const result = cleanDescription(input);
    expect(result).toBe('This is the real description.');
  });

  test('removes CHAPTER ONE CHAPTER TWO pattern (all caps)', () => {
    const input = 'CHAPTER ONE CHAPTER TWO CHAPTER THREE A wonderful story.';
    const result = cleanDescription(input);
    expect(result).toBe('A wonderful story.');
  });

  test('removes CHAPTER 1 CHAPTER 2 pattern (numbered)', () => {
    const input = 'CHAPTER 1 CHAPTER 2 CHAPTER 3 The adventure begins.';
    const result = cleanDescription(input);
    expect(result).toBe('The adventure begins.');
  });

  test('removes Ch. 1, Ch. 2 pattern (abbreviated)', () => {
    const input = 'Ch. 1, Ch. 2, Ch. 3, The story starts here.';
    const result = cleanDescription(input);
    expect(result).toBe('The story starts here.');
  });

  test('removes numbered lists from start', () => {
    const input = '1, 2, 3, 4, 5, Welcome to the audiobook.';
    const result = cleanDescription(input);
    expect(result).toBe('Welcome to the audiobook.');
  });

  test('removes hyphen-wrapped numbers', () => {
    const input = '-1- -2- -3- This is the content.';
    const result = cleanDescription(input);
    expect(result).toBe('This is the content.');
  });

  test('removes numbered lists with dots', () => {
    const input = '1. 2. 3. 4. Listen to this book.';
    const result = cleanDescription(input);
    expect(result).toBe('Listen to this book.');
  });

  test('removes numbered lists with parentheses', () => {
    const input = '1) 2) 3) 4) A great audiobook.';
    const result = cleanDescription(input);
    expect(result).toBe('A great audiobook.');
  });

  test('removes Track listing patterns', () => {
    const input = 'Track 1 Track 2 Track 3 The main story begins.';
    const result = cleanDescription(input);
    expect(result).toBe('The main story begins.');
  });

  test('removes Dedication at start', () => {
    const input = 'Dedication This book is a masterpiece.';
    const result = cleanDescription(input);
    expect(result).toBe('This book is a masterpiece.');
  });

  test('handles complex mixed chapter patterns', () => {
    const input = 'Opening Credits Chapter 1 Chapter 2 Chapter 3 Chapter 4 Chapter 5 Chapter 6 Chapter 7 Chapter 8 Chapter 9 Chapter 10 This is actually a really good book about science fiction.';
    const result = cleanDescription(input);
    expect(result).toBe('This is actually a really good book about science fiction.');
  });

  test('preserves normal descriptions without chapter patterns', () => {
    const input = 'This is a fantastic audiobook about the adventures of a young wizard learning to master their powers.';
    const result = cleanDescription(input);
    expect(result).toBe('This is a fantastic audiobook about the adventures of a young wizard learning to master their powers.');
  });

  test('handles chapter patterns with word numbers including hyphens', () => {
    const input = 'Chapter Twenty-One Chapter Twenty-Two The continuation of the story.';
    const result = cleanDescription(input);
    expect(result).toBe('The continuation of the story.');
  });

  test('returns trimmed result', () => {
    const input = '   Hello World   ';
    const result = cleanDescription(input);
    expect(result).toBe('Hello World');
  });

  test('handles real-world chapter listing example', () => {
    const input = `
      <p>Opening Credits</p>
      <p>Chapter 1</p>
      <p>Chapter 2</p>
      <p>Chapter 3</p>
      <p>End Credits</p>
      <p>In this thrilling adventure, our hero embarks on a journey that will change their life forever.</p>
    `;
    const result = cleanDescription(input);
    expect(result).toBe('In this thrilling adventure, our hero embarks on a journey that will change their life forever.');
  });

  test('extracts description from Q&A section', () => {
    const input = 'Track 1 Track 2 Q&A with the Author This audiobook explores the depths of human emotion in ways never before imagined.';
    const result = cleanDescription(input);
    expect(result).toBe('This audiobook explores the depths of human emotion in ways never before imagined.');
  });

  test('removes repeated Chapter N patterns aggressively', () => {
    const input = 'Chapter 1 Chapter 2 Chapter 3 Chapter 4 Chapter 5 Description starts here.';
    const result = cleanDescription(input);
    expect(result).toBe('Description starts here.');
  });

  test('handles Opening and End Credits together', () => {
    const input = 'Opening Credits End Credits The actual book content.';
    const result = cleanDescription(input);
    expect(result).toBe('The actual book content.');
  });

  test('removes multiple dedication patterns', () => {
    const input = 'Dedication Dedication Rest of description.';
    const result = cleanDescription(input);
    expect(result).toBe('Rest of description.');
  });
});
