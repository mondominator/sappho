/**
 * Clean chapter listings from description text
 * Extracts meaningful audiobook descriptions by removing chapter/track lists
 */

function cleanDescription(description) {
  if (!description) return '';

  let cleaned = description;

  // Strip HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, '');

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(num))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Normalize whitespace (multiple spaces/newlines to single space)
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Strategy 1: Check if the real description is AFTER chapter listings
  // Look for patterns like "End Credits [actual description]" or "Epilogue [actual description]"
  const afterCreditsMatch = cleaned.match(/(?:End\s+Credits|Epilogue|About\s+the\s+Author|Q&A\s+with\s+the\s+Author)\s+(.+)/is);
  if (afterCreditsMatch && afterCreditsMatch[1]) {
    const potentialDescription = afterCreditsMatch[1].trim();
    // Check if this looks like a real description (starts with a capital letter, has reasonable length)
    if (potentialDescription.length >= 50 && /^[A-Z<"]/.test(potentialDescription)) {
      // Remove any trailing "End Credits", "Epilogue", etc.
      cleaned = potentialDescription.replace(/\s*(Opening|End)\s+Credits\s*$/i, '').trim();
      return cleaned;
    }
  }

  // Strategy 2: Remove chapter listings from the beginning (original approach)
  // Remove Opening Credits / End Credits from start and end
  cleaned = cleaned.replace(/^(\s*(Opening|End)\s+Credits\s*)+/i, '');
  cleaned = cleaned.replace(/(\s*(Opening|End)\s+Credits\s*)+$/i, '');

  // Pattern: "Dedication Part 1: Name Chapter 1 Chapter 2..." (common in audiobooks)
  cleaned = cleaned.replace(/^(\s*Dedication\s+)?Part\s+\d+:\s*[A-Za-z\s]+(\s+Chapter\s+\d+)+/i, '');

  // Pattern 1: "Chapter One Chapter Two..." or "Chapter Twenty-One..." (word-based with optional hyphens)
  cleaned = cleaned.replace(/^(\s*Chapter\s+([A-Z][a-z]+(-[A-Z][a-z]+)*)\s*)+/i, '');

  // Pattern 2: "CHAPTER ONE CHAPTER TWO CHAPTER THREE..." (all caps word-based)
  cleaned = cleaned.replace(/^(\s*CHAPTER\s+[A-Z]+(\s+[A-Z]+)*\s*)+/i, '');

  // Pattern 3: "CHAPTER 1 CHAPTER 2 CHAPTER 3..." (number-based)
  cleaned = cleaned.replace(/^(\s*CHAPTER\s+\d+\s*)+/i, '');

  // Pattern 4: "Chapter One, Chapter Two, Chapter Three..." (comma-separated)
  cleaned = cleaned.replace(/^(\s*Chapter\s+[A-Za-z]+(\s+[A-Za-z]+)?,?\s*)+/i, '');

  // Pattern 5: "Ch. 1, Ch. 2, Ch. 3..." (abbreviated)
  cleaned = cleaned.replace(/^(\s*Ch\.\s*\d+,?\s*)+/i, '');

  // Pattern 6: Just numbers separated by spaces/commas at the start
  cleaned = cleaned.replace(/^(\s*\d+[,\s]+)+/, '');

  // Pattern 7: "-1-", "-2-", "-3-" or similar hyphen-wrapped numbers
  cleaned = cleaned.replace(/^(\s*-\d+-?\s*)+/, '');

  // Pattern 8: "1. 2. 3." or "1) 2) 3)" (numbered lists)
  cleaned = cleaned.replace(/^(\s*\d+[.)]\s*)+/, '');

  // Pattern 9: Track listing patterns like "01 - ", "Track 1", etc.
  cleaned = cleaned.replace(/^(\s*(Track\s+)?\d+(\s*-\s*|\s+))+/i, '');

  // Remove repeating "Chapter N" patterns more aggressively
  // This handles cases like "Chapter 1 Chapter 2 Chapter 3..." that slip through
  cleaned = cleaned.replace(/^(.*?Chapter\s+\d+\s*)+/i, '');

  // Remove "Part N: Title" patterns at the beginning
  cleaned = cleaned.replace(/^(\s*Part\s+\d+:\s*[^\n]+\s*)+/gi, '');

  // Clean up any remaining Opening/End Credits
  cleaned = cleaned.replace(/^(\s*(Opening|End)\s+Credits\s*)+/i, '');
  cleaned = cleaned.replace(/(\s*(Opening|End)\s+Credits\s*)+$/i, '');

  // Remove "Dedication" if it's still at the start
  cleaned = cleaned.replace(/^(\s*Dedication\s*)+/i, '');

  return cleaned.trim();
}

module.exports = { cleanDescription };
