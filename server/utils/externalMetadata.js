/**
 * Read external metadata files alongside audiobook directories.
 *
 * Supports:
 *   - desc.txt / description.txt   - Book description/summary
 *   - reader.txt / narrator.txt    - Narrator name
 *   - metadata.opf / *.opf         - OPF (Open Packaging Format) XML (Calibre, etc.)
 *
 * OPF fields parsed:
 *   <dc:title>         -> title
 *   <dc:creator>       -> author
 *   <dc:description>   -> description
 *   <dc:publisher>     -> publisher
 *   <dc:language>       -> language
 *   <dc:date>          -> published_year
 *   <dc:identifier>    -> isbn (when opf:scheme="ISBN")
 *   <meta name="calibre:series">        -> series
 *   <meta name="calibre:series_index">  -> seriesPosition
 */

const fs = require('fs');
const path = require('path');

/**
 * Try to read a text file, returning its trimmed content or null.
 */
function readTextFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8').trim();
    return content || null;
  } catch (_err) {
    return null;
  }
}

/**
 * Find the first OPF file in a directory.
 * Checks metadata.opf first, then any *.opf file.
 */
function findOpfFile(dir) {
  // Prefer metadata.opf (Calibre convention)
  const metadataOpf = path.join(dir, 'metadata.opf');
  if (fs.existsSync(metadataOpf)) return metadataOpf;

  // Fallback: any *.opf file
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (path.extname(entry).toLowerCase() === '.opf') {
        return path.join(dir, entry);
      }
    }
  } catch (_err) {
    // directory not readable
  }
  return null;
}

/**
 * Extract a single XML tag's text content using regex.
 * Returns the first match or null.
 *
 * @param {string} xml   - The XML string to search
 * @param {string} tag   - The tag name (may include namespace prefix, e.g. "dc:title")
 * @returns {string|null}
 */
function extractTagContent(xml, tag) {
  // Escape special regex characters in tag name (the colon is fine)
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)</${escaped}>`, 'i');
  const match = xml.match(regex);
  if (match && match[1]) {
    // Strip any nested HTML/XML tags and decode basic entities
    // Strip HTML/XML tags, decode entities, then re-strip for safety
    let text = match[1].replace(/<[^>]*>/g, '');
    const entityMap = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    text = text.replace(/&(amp|lt|gt|quot|apos);/gi, (m) => entityMap[m.toLowerCase()] || m);
    text = text.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
    text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    text = text.replace(/<[^>]*>/g, '').trim();
    return text || null;
  }
  return null;
}

/**
 * Extract a <meta> tag's content attribute by name.
 * Handles both name-first and content-first attribute ordering.
 *
 * @param {string} xml  - The XML string
 * @param {string} name - The value of the name attribute
 * @returns {string|null}
 */
function extractMetaContent(xml, name) {
  // Find all <meta> tags (self-closing or not)
  const metaRegex = /<meta\s[^>]*?(?:name|property)\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let match;
  while ((match = metaRegex.exec(xml)) !== null) {
    const fullTag = match[0];
    const matchedName = match[1];

    if (matchedName.toLowerCase() === name.toLowerCase()) {
      // Extract content attribute from this tag
      const contentMatch = fullTag.match(/content\s*=\s*["']([^"']*)["']/i);
      if (contentMatch) {
        return contentMatch[1].trim() || null;
      }
    }
  }
  return null;
}

/**
 * Parse an OPF file and return extracted metadata.
 *
 * @param {string} opfPath - Path to the .opf file
 * @returns {object} Metadata object with available fields
 */
function parseOpfFile(opfPath) {
  const result = {};

  try {
    const xml = fs.readFileSync(opfPath, 'utf8');

    // dc:title
    const title = extractTagContent(xml, 'dc:title');
    if (title) result.title = title;

    // dc:creator (author)
    const creator = extractTagContent(xml, 'dc:creator');
    if (creator) result.author = creator;

    // dc:description
    const description = extractTagContent(xml, 'dc:description');
    if (description) result.description = description;

    // dc:publisher
    const publisher = extractTagContent(xml, 'dc:publisher');
    if (publisher) result.publisher = publisher;

    // dc:language
    const language = extractTagContent(xml, 'dc:language');
    if (language) result.language = language;

    // dc:date -> published_year
    const date = extractTagContent(xml, 'dc:date');
    if (date) {
      const yearMatch = date.match(/(\d{4})/);
      if (yearMatch) {
        result.published_year = parseInt(yearMatch[1], 10);
      }
    }

    // dc:identifier with ISBN scheme
    // Look for <dc:identifier opf:scheme="ISBN">...</dc:identifier>
    const isbnRegex = /<dc:identifier[^>]*opf:scheme\s*=\s*["']ISBN["'][^>]*>([\s\S]*?)<\/dc:identifier>/i;
    const isbnMatch = xml.match(isbnRegex);
    if (isbnMatch && isbnMatch[1]) {
      const isbn = isbnMatch[1].trim();
      if (isbn) result.isbn = isbn;
    }

    // calibre:series
    const series = extractMetaContent(xml, 'calibre:series');
    if (series) result.series = series;

    // calibre:series_index
    const seriesIndex = extractMetaContent(xml, 'calibre:series_index');
    if (seriesIndex) {
      const parsed = parseFloat(seriesIndex);
      if (!isNaN(parsed)) {
        result.series_position = parsed;
      }
    }
  } catch (err) {
    console.error(`Error parsing OPF file ${opfPath}:`, err.message);
  }

  return result;
}

/**
 * Read all external metadata files from an audiobook directory.
 * Returns an object with any discovered metadata fields.
 *
 * @param {string} bookDir - Absolute path to the audiobook directory
 * @returns {Promise<object>} Metadata object (keys only present if data was found)
 */
async function readExternalMetadata(bookDir) {
  const result = {};

  // 1. Description files
  const descriptionFiles = ['desc.txt', 'description.txt'];
  for (const filename of descriptionFiles) {
    const content = readTextFile(path.join(bookDir, filename));
    if (content) {
      result.description = content;
      break;
    }
  }

  // 2. Narrator files
  const narratorFiles = ['reader.txt', 'narrator.txt'];
  for (const filename of narratorFiles) {
    const content = readTextFile(path.join(bookDir, filename));
    if (content) {
      result.narrator = content;
      break;
    }
  }

  // 3. OPF file
  const opfPath = findOpfFile(bookDir);
  if (opfPath) {
    const opfMeta = parseOpfFile(opfPath);
    // Merge OPF data into result (OPF fills gaps, doesn't overwrite txt files)
    for (const [key, value] of Object.entries(opfMeta)) {
      if (!(key in result)) {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Merge external metadata into existing audio-tag metadata.
 * External data only fills in empty/null/undefined fields; it never overwrites.
 *
 * @param {object} metadata        - Metadata extracted from audio tags
 * @param {object} externalMeta    - Metadata from external files
 * @returns {object} The mutated metadata object (same reference)
 */
function mergeExternalMetadata(metadata, externalMeta) {
  if (!externalMeta || typeof externalMeta !== 'object') return metadata;

  for (const [key, value] of Object.entries(externalMeta)) {
    if (value !== null && value !== undefined && value !== '' && (metadata[key] === null || metadata[key] === undefined || metadata[key] === '')) {
      metadata[key] = value;
    }
  }
  return metadata;
}

module.exports = {
  readExternalMetadata,
  mergeExternalMetadata,
  // Exported for testing
  readTextFile,
  findOpfFile,
  parseOpfFile,
  extractTagContent,
  extractMetaContent,
};
