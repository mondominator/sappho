/**
 * Genre normalization utilities
 * Maps various genre strings to standardized categories
 */

const GENRE_MAPPINGS = {
  'Mystery & Thriller': {
    keywords: [
      'mystery', 'thriller', 'suspense', 'detective', 'crime', 'crime fiction',
      'murder mystery', 'whodunit', 'noir', 'police procedural', 'legal thriller',
      'psychological thriller', 'espionage', 'spy', 'cozy mystery'
    ],
    colors: ['#6366f1', '#4338ca'],
    icon: 'search'
  },
  'Science Fiction': {
    keywords: [
      'science fiction', 'sci-fi', 'scifi', 'sf', 'space opera', 'cyberpunk',
      'dystopia', 'dystopian', 'post-apocalyptic', 'apocalyptic', 'alien',
      'time travel', 'hard science fiction', 'soft science fiction', 'military science fiction'
    ],
    colors: ['#06b6d4', '#0891b2'],
    icon: 'rocket'
  },
  'Fantasy': {
    keywords: [
      'fantasy', 'epic fantasy', 'high fantasy', 'urban fantasy', 'dark fantasy',
      'sword and sorcery', 'paranormal', 'magic', 'dragons', 'wizards',
      'mythological', 'fairy tale', 'folklore', 'grimdark', 'portal fantasy'
    ],
    colors: ['#8b5cf6', '#6d28d9'],
    icon: 'auto_awesome'
  },
  'Romance': {
    keywords: [
      'romance', 'romantic', 'love story', 'contemporary romance', 'historical romance',
      'paranormal romance', 'romantic suspense', 'romantic comedy', 'rom-com',
      'regency romance', 'erotic romance', 'clean romance'
    ],
    colors: ['#ec4899', '#db2777'],
    icon: 'favorite'
  },
  'Horror': {
    keywords: [
      'horror', 'scary', 'supernatural horror', 'gothic', 'haunted',
      'ghost story', 'zombies', 'vampires', 'occult', 'dark fiction'
    ],
    colors: ['#991b1b', '#7f1d1d'],
    icon: 'visibility'
  },
  'Historical Fiction': {
    keywords: [
      'historical fiction', 'historical', 'historical novel',
      'period drama', 'civil war', 'world war', 'medieval', 'victorian',
      'ancient rome', 'ancient greece', 'tudor', 'regency'
    ],
    colors: ['#a1887f', '#8d6e63'],
    icon: 'castle'
  },
  'Biography & Memoir': {
    keywords: [
      'biography', 'memoir', 'autobiography', 'memoirs', 'biographies',
      'personal narratives', 'life stories', 'biographical'
    ],
    colors: ['#14b8a6', '#0d9488'],
    icon: 'person'
  },
  'Self-Help': {
    keywords: [
      'self-help', 'self help', 'personal development', 'personal growth',
      'self-improvement', 'motivation', 'motivational', 'inspirational',
      'success', 'happiness', 'mindfulness', 'productivity', 'habits'
    ],
    colors: ['#10b981', '#059669'],
    icon: 'psychology'
  },
  'Business & Finance': {
    keywords: [
      'business', 'finance', 'economics', 'investing', 'entrepreneurship',
      'management', 'leadership', 'marketing', 'money', 'career',
      'real estate', 'stock market', 'personal finance', 'wealth'
    ],
    colors: ['#0d9488', '#0f766e'],
    icon: 'trending_up'
  },
  'History': {
    keywords: [
      'american history', 'world history', 'military history',
      'ancient history', 'modern history', 'european history', 'asian history',
      'nonfiction history', 'non-fiction history'
    ],
    colors: ['#78716c', '#57534e'],
    icon: 'history_edu'
  },
  'Science & Technology': {
    keywords: [
      'popular science', 'physics', 'chemistry', 'biology', 'astronomy',
      'mathematics', 'engineering', 'computer science', 'artificial intelligence',
      'nature', 'environment', 'ecology', 'evolution', 'neuroscience', 'medicine',
      'nonfiction science', 'non-fiction science', 'science nonfiction', 'technology nonfiction'
    ],
    colors: ['#3b82f6', '#2563eb'],
    icon: 'science'
  },
  'Health & Wellness': {
    keywords: [
      'health', 'wellness', 'fitness', 'nutrition', 'diet', 'exercise',
      'mental health', 'psychology', 'meditation', 'yoga', 'healing',
      'alternative medicine', 'holistic'
    ],
    colors: ['#22c55e', '#16a34a'],
    icon: 'favorite_border'
  },
  'Religion & Spirituality': {
    keywords: [
      'religion', 'spirituality', 'spiritual', 'christian', 'christianity',
      'buddhism', 'buddhist', 'islam', 'jewish', 'judaism', 'faith',
      'prayer', 'bible', 'theology', 'new age', 'metaphysical'
    ],
    colors: ['#8b5cf6', '#7c3aed'],
    icon: 'self_improvement'
  },
  'True Crime': {
    keywords: [
      'true crime', 'true-crime', 'criminal', 'forensic', 'serial killer',
      'cold case', 'investigation'
    ],
    colors: ['#71717a', '#52525b'],
    icon: 'gavel'
  },
  'Comedy & Humor': {
    keywords: [
      'comedy', 'humor', 'humorous', 'funny', 'satire', 'parody',
      'wit', 'jokes', 'stand-up'
    ],
    colors: ['#fcd34d', '#fbbf24'],
    icon: 'sentiment_very_satisfied'
  },
  'Young Adult': {
    keywords: [
      'young adult', 'ya', 'teen', 'teenage', 'adolescent', 'coming of age',
      'coming-of-age', 'juvenile fiction'
    ],
    colors: ['#a855f7', '#9333ea'],
    icon: 'face'
  },
  'Children\'s': {
    keywords: [
      'children', 'kids', 'juvenile', 'picture book', 'middle grade',
      'chapter book', 'bedtime stories'
    ],
    colors: ['#fbbf24', '#f59e0b'],
    icon: 'child_care'
  },
  'Classics': {
    keywords: [
      'classic', 'classics', 'classic literature', 'classic fiction',
      'literary classics', 'great books'
    ],
    colors: ['#a78bfa', '#7c3aed'],
    icon: 'menu_book'
  },
  'Poetry': {
    keywords: [
      'poetry', 'poems', 'verse', 'poetic'
    ],
    colors: ['#f472b6', '#ec4899'],
    icon: 'edit_note'
  },
  'Drama': {
    keywords: [
      'drama', 'plays', 'theater', 'theatre', 'dramatic'
    ],
    colors: ['#f97316', '#ea580c'],
    icon: 'theater_comedy'
  },
  'Adventure': {
    keywords: [
      'adventure', 'action', 'action & adventure', 'action-adventure',
      'survival', 'exploration', 'quest'
    ],
    colors: ['#f59e0b', '#d97706'],
    icon: 'explore'
  },
  'Western': {
    keywords: [
      'western', 'westerns', 'cowboy', 'frontier', 'wild west'
    ],
    colors: ['#d97706', '#b45309'],
    icon: 'landscape'
  },
  'LitRPG': {
    keywords: [
      'litrpg', 'lit-rpg', 'gamelit', 'game-lit', 'progression fantasy'
    ],
    colors: ['#22d3ee', '#06b6d4'],
    icon: 'sports_esports'
  },
  'Erotica': {
    keywords: [
      'erotica', 'erotic', 'adult fiction', 'steamy'
    ],
    colors: ['#f43f5e', '#e11d48'],
    icon: 'local_fire_department'
  }
};

// Default colors and icon for genres not in the mapping
const DEFAULT_GENRE_METADATA = {
  colors: ['#10b981', '#059669'],
  icon: 'category'
};

/**
 * Normalize a genre string to a major bookstore category
 * Returns the first matching category, or null if no match
 */
function normalizeGenre(genreStr) {
  if (!genreStr) return null;

  const lower = genreStr.toLowerCase().trim();

  for (const [category, data] of Object.entries(GENRE_MAPPINGS)) {
    for (const keyword of data.keywords) {
      if (lower === keyword || lower.includes(keyword)) {
        return category;
      }
    }
  }

  return null;
}

/**
 * Normalize a comma-separated genre string to major categories
 * Returns unique categories, prioritized by mapping order
 */
function normalizeGenres(genreStr) {
  if (!genreStr) return null;

  const genres = genreStr.split(',').map(g => g.trim()).filter(Boolean);
  const normalized = new Set();

  for (const genre of genres) {
    const category = normalizeGenre(genre);
    if (category) {
      normalized.add(category);
    }
  }

  // Return up to 3 categories to keep it concise
  const result = Array.from(normalized).slice(0, 3);
  return result.length > 0 ? result.join(', ') : null;
}

/**
 * Get metadata (colors, icon) for a genre
 */
function getGenreMetadata(genre) {
  return GENRE_MAPPINGS[genre] || DEFAULT_GENRE_METADATA;
}

module.exports = {
  GENRE_MAPPINGS,
  DEFAULT_GENRE_METADATA,
  normalizeGenre,
  normalizeGenres,
  getGenreMetadata
};
