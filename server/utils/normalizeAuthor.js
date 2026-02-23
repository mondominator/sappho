function normalizeAuthor(author) {
  if (!author) return author;
  return author
    .replace(/\.([A-Z])/g, '. $1')  // Standardize initials: "B.V." → "B. V."
    .replace(/\s+/g, ' ')            // Collapse whitespace
    .trim() || null;
}

module.exports = { normalizeAuthor };
