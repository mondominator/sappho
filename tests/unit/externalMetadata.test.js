/**
 * Unit tests for external metadata reader utility
 * Tests reading desc.txt, narrator.txt, *.opf files and merging logic
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  readExternalMetadata,
  mergeExternalMetadata,
  readTextFile,
  findOpfFile,
  parseOpfFile,
  extractTagContent,
  extractMetaContent,
} = require('../../server/utils/externalMetadata');

// Helper to create a temporary directory with files
function createTempDir(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sappho-test-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

// Helper to clean up temp directories
function removeTempDir(dir) {
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      fs.unlinkSync(path.join(dir, entry));
    }
    fs.rmdirSync(dir);
  } catch (_err) {
    // best effort cleanup
  }
}

// ── extractTagContent ────────────────────────────────────────────────

describe('extractTagContent', () => {
  test('extracts simple tag content', () => {
    const xml = '<dc:title>My Book Title</dc:title>';
    expect(extractTagContent(xml, 'dc:title')).toBe('My Book Title');
  });

  test('extracts content with attributes on the tag', () => {
    const xml = '<dc:creator opf:role="aut" opf:file-as="Doe, John">John Doe</dc:creator>';
    expect(extractTagContent(xml, 'dc:creator')).toBe('John Doe');
  });

  test('returns null for missing tag', () => {
    const xml = '<dc:title>Title</dc:title>';
    expect(extractTagContent(xml, 'dc:creator')).toBeNull();
  });

  test('strips nested HTML/XML tags', () => {
    const xml = '<dc:description><p>A <b>great</b> book.</p></dc:description>';
    expect(extractTagContent(xml, 'dc:description')).toBe('A great book.');
  });

  test('decodes HTML entities', () => {
    const xml = '<dc:title>Tom &amp; Jerry&apos;s &quot;Adventure&quot;</dc:title>';
    expect(extractTagContent(xml, 'dc:title')).toBe("Tom & Jerry's \"Adventure\"");
  });

  test('decodes numeric entities', () => {
    const xml = '<dc:title>&#65;&#66;&#67;</dc:title>';
    expect(extractTagContent(xml, 'dc:title')).toBe('ABC');
  });

  test('decodes hex entities', () => {
    const xml = '<dc:title>&#x41;&#x42;&#x43;</dc:title>';
    expect(extractTagContent(xml, 'dc:title')).toBe('ABC');
  });

  test('returns null for empty tag', () => {
    const xml = '<dc:title></dc:title>';
    expect(extractTagContent(xml, 'dc:title')).toBeNull();
  });

  test('returns null for whitespace-only tag', () => {
    const xml = '<dc:title>   </dc:title>';
    expect(extractTagContent(xml, 'dc:title')).toBeNull();
  });

  test('handles multiline content', () => {
    const xml = '<dc:description>\n  A long description\n  that spans multiple lines.\n</dc:description>';
    expect(extractTagContent(xml, 'dc:description')).toBe('A long description\n  that spans multiple lines.');
  });

  test('is case-insensitive for tag matching', () => {
    const xml = '<DC:Title>My Title</DC:Title>';
    expect(extractTagContent(xml, 'dc:title')).toBe('My Title');
  });
});

// ── extractMetaContent ───────────────────────────────────────────────

describe('extractMetaContent', () => {
  test('extracts content from meta tag with name attribute', () => {
    const xml = '<meta name="calibre:series" content="The Lord of the Rings"/>';
    expect(extractMetaContent(xml, 'calibre:series')).toBe('The Lord of the Rings');
  });

  test('extracts content from meta tag with double quotes', () => {
    const xml = '<meta name="calibre:series_index" content="2.0"/>';
    expect(extractMetaContent(xml, 'calibre:series_index')).toBe('2.0');
  });

  test('handles content-first attribute ordering', () => {
    const xml = '<meta content="The Hobbit Series" name="calibre:series"/>';
    expect(extractMetaContent(xml, 'calibre:series')).toBe('The Hobbit Series');
  });

  test('returns null for missing meta name', () => {
    const xml = '<meta name="calibre:series" content="Test"/>';
    expect(extractMetaContent(xml, 'calibre:other')).toBeNull();
  });

  test('is case-insensitive for name comparison', () => {
    const xml = '<meta name="Calibre:Series" content="My Series"/>';
    expect(extractMetaContent(xml, 'calibre:series')).toBe('My Series');
  });

  test('returns null when no meta tags present', () => {
    const xml = '<dc:title>Test</dc:title>';
    expect(extractMetaContent(xml, 'calibre:series')).toBeNull();
  });

  test('returns null for empty content', () => {
    const xml = '<meta name="calibre:series" content=""/>';
    expect(extractMetaContent(xml, 'calibre:series')).toBeNull();
  });

  test('handles multiple meta tags and picks the right one', () => {
    const xml = `
      <meta name="calibre:series" content="Series A"/>
      <meta name="calibre:series_index" content="3"/>
    `;
    expect(extractMetaContent(xml, 'calibre:series')).toBe('Series A');
    expect(extractMetaContent(xml, 'calibre:series_index')).toBe('3');
  });
});

// ── readTextFile ─────────────────────────────────────────────────────

describe('readTextFile', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) removeTempDir(tmpDir);
  });

  test('reads content from an existing text file', () => {
    tmpDir = createTempDir({ 'test.txt': 'Hello World' });
    expect(readTextFile(path.join(tmpDir, 'test.txt'))).toBe('Hello World');
  });

  test('trims whitespace from content', () => {
    tmpDir = createTempDir({ 'test.txt': '  spaced content  \n' });
    expect(readTextFile(path.join(tmpDir, 'test.txt'))).toBe('spaced content');
  });

  test('returns null for non-existent file', () => {
    expect(readTextFile('/nonexistent/path/file.txt')).toBeNull();
  });

  test('returns null for empty file', () => {
    tmpDir = createTempDir({ 'empty.txt': '' });
    expect(readTextFile(path.join(tmpDir, 'empty.txt'))).toBeNull();
  });

  test('returns null for whitespace-only file', () => {
    tmpDir = createTempDir({ 'whitespace.txt': '   \n  \n  ' });
    expect(readTextFile(path.join(tmpDir, 'whitespace.txt'))).toBeNull();
  });

  test('returns null when fs.readFileSync throws (e.g., permission error)', () => {
    tmpDir = createTempDir({ 'noperm.txt': 'content' });
    const filePath = path.join(tmpDir, 'noperm.txt');
    // Make the file unreadable
    fs.chmodSync(filePath, 0o000);
    expect(readTextFile(filePath)).toBeNull();
    // Restore permissions for cleanup
    fs.chmodSync(filePath, 0o644);
  });
});

// ── findOpfFile ──────────────────────────────────────────────────────

describe('findOpfFile', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) removeTempDir(tmpDir);
  });

  test('finds metadata.opf by convention', () => {
    tmpDir = createTempDir({ 'metadata.opf': '<package/>' });
    expect(findOpfFile(tmpDir)).toBe(path.join(tmpDir, 'metadata.opf'));
  });

  test('finds a differently-named .opf file', () => {
    tmpDir = createTempDir({ 'mybook.opf': '<package/>' });
    expect(findOpfFile(tmpDir)).toBe(path.join(tmpDir, 'mybook.opf'));
  });

  test('prefers metadata.opf over other .opf files', () => {
    tmpDir = createTempDir({
      'metadata.opf': '<package>preferred</package>',
      'other.opf': '<package>other</package>',
    });
    expect(findOpfFile(tmpDir)).toBe(path.join(tmpDir, 'metadata.opf'));
  });

  test('returns null when no .opf files exist', () => {
    tmpDir = createTempDir({ 'readme.txt': 'hello' });
    expect(findOpfFile(tmpDir)).toBeNull();
  });

  test('returns null for non-existent directory', () => {
    expect(findOpfFile('/nonexistent/directory')).toBeNull();
  });

  test('returns null when directory is not readable', () => {
    tmpDir = createTempDir({ 'book.opf': '<package/>' });
    // Make directory unreadable (but we need it to exist and not have metadata.opf)
    // Rename the opf file to something else first, then make unreadable
    const noMetaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sappho-noperm-'));
    fs.writeFileSync(path.join(noMetaDir, 'book.opf'), '<package/>');
    fs.chmodSync(noMetaDir, 0o000);
    expect(findOpfFile(noMetaDir)).toBeNull();
    // Restore permissions for cleanup
    fs.chmodSync(noMetaDir, 0o755);
    fs.unlinkSync(path.join(noMetaDir, 'book.opf'));
    fs.rmdirSync(noMetaDir);
  });
});

// ── parseOpfFile ─────────────────────────────────────────────────────

describe('parseOpfFile', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) removeTempDir(tmpDir);
  });

  const FULL_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>The Great Adventure</dc:title>
    <dc:creator opf:role="aut" opf:file-as="Doe, John">John Doe</dc:creator>
    <dc:description>An epic tale of adventure and discovery.</dc:description>
    <dc:publisher>Acme Publishing</dc:publisher>
    <dc:language>en</dc:language>
    <dc:date>2020-05-15</dc:date>
    <dc:identifier opf:scheme="ISBN">9781234567890</dc:identifier>
    <meta name="calibre:series" content="Adventure Series"/>
    <meta name="calibre:series_index" content="3"/>
  </metadata>
</package>`;

  test('parses all fields from a complete OPF file', () => {
    tmpDir = createTempDir({ 'metadata.opf': FULL_OPF });
    const result = parseOpfFile(path.join(tmpDir, 'metadata.opf'));

    expect(result.title).toBe('The Great Adventure');
    expect(result.author).toBe('John Doe');
    expect(result.description).toBe('An epic tale of adventure and discovery.');
    expect(result.publisher).toBe('Acme Publishing');
    expect(result.language).toBe('en');
    expect(result.published_year).toBe(2020);
    expect(result.isbn).toBe('9781234567890');
    expect(result.series).toBe('Adventure Series');
    expect(result.series_position).toBe(3);
  });

  test('handles OPF with only title and author', () => {
    const xml = `<?xml version="1.0"?>
<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Minimal Book</dc:title>
  <dc:creator>Jane Author</dc:creator>
</metadata></package>`;
    tmpDir = createTempDir({ 'metadata.opf': xml });
    const result = parseOpfFile(path.join(tmpDir, 'metadata.opf'));

    expect(result.title).toBe('Minimal Book');
    expect(result.author).toBe('Jane Author');
    expect(result.description).toBeUndefined();
    expect(result.series).toBeUndefined();
  });

  test('handles fractional series index', () => {
    const xml = `<package><metadata>
      <meta name="calibre:series" content="My Series"/>
      <meta name="calibre:series_index" content="2.5"/>
    </metadata></package>`;
    tmpDir = createTempDir({ 'metadata.opf': xml });
    const result = parseOpfFile(path.join(tmpDir, 'metadata.opf'));

    expect(result.series).toBe('My Series');
    expect(result.series_position).toBe(2.5);
  });

  test('handles HTML entities in description', () => {
    const xml = `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:description>A &quot;thrilling&quot; tale of love &amp; war.</dc:description>
    </metadata></package>`;
    tmpDir = createTempDir({ 'metadata.opf': xml });
    const result = parseOpfFile(path.join(tmpDir, 'metadata.opf'));

    expect(result.description).toBe('A "thrilling" tale of love & war.');
  });

  test('extracts year from date-only string', () => {
    const xml = `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:date>1999</dc:date>
    </metadata></package>`;
    tmpDir = createTempDir({ 'metadata.opf': xml });
    const result = parseOpfFile(path.join(tmpDir, 'metadata.opf'));

    expect(result.published_year).toBe(1999);
  });

  test('returns empty object for non-existent file', () => {
    const result = parseOpfFile('/nonexistent/metadata.opf');
    expect(result).toEqual({});
  });

  test('returns empty object for empty XML', () => {
    tmpDir = createTempDir({ 'metadata.opf': '' });
    const result = parseOpfFile(path.join(tmpDir, 'metadata.opf'));
    expect(result).toEqual({});
  });

  test('handles OPF with HTML in description', () => {
    const xml = `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:description><p>A <b>bold</b> adventure.</p></dc:description>
    </metadata></package>`;
    tmpDir = createTempDir({ 'metadata.opf': xml });
    const result = parseOpfFile(path.join(tmpDir, 'metadata.opf'));

    expect(result.description).toBe('A bold adventure.');
  });

  test('handles invalid series_index gracefully', () => {
    const xml = `<package><metadata>
      <meta name="calibre:series_index" content="not-a-number"/>
    </metadata></package>`;
    tmpDir = createTempDir({ 'metadata.opf': xml });
    const result = parseOpfFile(path.join(tmpDir, 'metadata.opf'));

    expect(result.series_position).toBeUndefined();
  });

  test('handles date without a 4-digit year', () => {
    const xml = `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:date>no-year-here</dc:date>
    </metadata></package>`;
    tmpDir = createTempDir({ 'metadata.opf': xml });
    const result = parseOpfFile(path.join(tmpDir, 'metadata.opf'));

    expect(result.published_year).toBeUndefined();
  });

  test('handles ISBN identifier with empty content', () => {
    const xml = `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
      <dc:identifier opf:scheme="ISBN">   </dc:identifier>
    </metadata></package>`;
    tmpDir = createTempDir({ 'metadata.opf': xml });
    const result = parseOpfFile(path.join(tmpDir, 'metadata.opf'));

    expect(result.isbn).toBeUndefined();
  });

  test('handles meta tag with name but no content attribute', () => {
    const xml = `<package><metadata>
      <meta name="calibre:series"/>
    </metadata></package>`;
    tmpDir = createTempDir({ 'metadata.opf': xml });
    const result = parseOpfFile(path.join(tmpDir, 'metadata.opf'));

    expect(result.series).toBeUndefined();
  });
});

// ── readExternalMetadata ─────────────────────────────────────────────

describe('readExternalMetadata', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) removeTempDir(tmpDir);
  });

  test('reads description from desc.txt', async () => {
    tmpDir = createTempDir({ 'desc.txt': 'A wonderful story about discovery.' });
    const result = await readExternalMetadata(tmpDir);
    expect(result.description).toBe('A wonderful story about discovery.');
  });

  test('reads description from description.txt', async () => {
    tmpDir = createTempDir({ 'description.txt': 'A tale of two cities.' });
    const result = await readExternalMetadata(tmpDir);
    expect(result.description).toBe('A tale of two cities.');
  });

  test('prefers desc.txt over description.txt', async () => {
    tmpDir = createTempDir({
      'desc.txt': 'From desc.txt',
      'description.txt': 'From description.txt',
    });
    const result = await readExternalMetadata(tmpDir);
    expect(result.description).toBe('From desc.txt');
  });

  test('reads narrator from reader.txt', async () => {
    tmpDir = createTempDir({ 'reader.txt': 'Stephen Fry' });
    const result = await readExternalMetadata(tmpDir);
    expect(result.narrator).toBe('Stephen Fry');
  });

  test('reads narrator from narrator.txt', async () => {
    tmpDir = createTempDir({ 'narrator.txt': 'Morgan Freeman' });
    const result = await readExternalMetadata(tmpDir);
    expect(result.narrator).toBe('Morgan Freeman');
  });

  test('prefers reader.txt over narrator.txt', async () => {
    tmpDir = createTempDir({
      'reader.txt': 'Reader Name',
      'narrator.txt': 'Narrator Name',
    });
    const result = await readExternalMetadata(tmpDir);
    expect(result.narrator).toBe('Reader Name');
  });

  test('reads metadata from OPF file', async () => {
    const opf = `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>OPF Title</dc:title>
      <dc:creator>OPF Author</dc:creator>
      <meta name="calibre:series" content="Test Series"/>
      <meta name="calibre:series_index" content="5"/>
    </metadata></package>`;
    tmpDir = createTempDir({ 'metadata.opf': opf });
    const result = await readExternalMetadata(tmpDir);

    expect(result.title).toBe('OPF Title');
    expect(result.author).toBe('OPF Author');
    expect(result.series).toBe('Test Series');
    expect(result.series_position).toBe(5);
  });

  test('text files take priority over OPF for description', async () => {
    const opf = `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:description>OPF description</dc:description>
    </metadata></package>`;
    tmpDir = createTempDir({
      'desc.txt': 'Text file description',
      'metadata.opf': opf,
    });
    const result = await readExternalMetadata(tmpDir);
    expect(result.description).toBe('Text file description');
  });

  test('returns empty object when no external files exist', async () => {
    tmpDir = createTempDir({});
    const result = await readExternalMetadata(tmpDir);
    expect(result).toEqual({});
  });

  test('combines text files and OPF data', async () => {
    const opf = `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>My Book</dc:title>
      <dc:creator>Author Name</dc:creator>
      <meta name="calibre:series" content="Epic Series"/>
    </metadata></package>`;
    tmpDir = createTempDir({
      'desc.txt': 'A custom description',
      'narrator.txt': 'Custom Narrator',
      'metadata.opf': opf,
    });
    const result = await readExternalMetadata(tmpDir);

    expect(result.description).toBe('A custom description');
    expect(result.narrator).toBe('Custom Narrator');
    expect(result.title).toBe('My Book');
    expect(result.author).toBe('Author Name');
    expect(result.series).toBe('Epic Series');
  });
});

// ── mergeExternalMetadata ────────────────────────────────────────────

describe('mergeExternalMetadata', () => {
  test('fills in null fields from external data', () => {
    const metadata = { title: 'My Book', author: 'Author', description: null, narrator: null };
    const external = { description: 'External desc', narrator: 'External narrator' };

    mergeExternalMetadata(metadata, external);

    expect(metadata.description).toBe('External desc');
    expect(metadata.narrator).toBe('External narrator');
  });

  test('fills in undefined fields from external data', () => {
    const metadata = { title: 'My Book' };
    const external = { narrator: 'Narrator Name', series: 'A Series' };

    mergeExternalMetadata(metadata, external);

    expect(metadata.narrator).toBe('Narrator Name');
    expect(metadata.series).toBe('A Series');
  });

  test('does NOT overwrite existing non-empty fields', () => {
    const metadata = { title: 'Original Title', author: 'Original Author', description: 'Original Desc' };
    const external = { title: 'External Title', author: 'External Author', description: 'External Desc' };

    mergeExternalMetadata(metadata, external);

    expect(metadata.title).toBe('Original Title');
    expect(metadata.author).toBe('Original Author');
    expect(metadata.description).toBe('Original Desc');
  });

  test('fills empty string fields from external data', () => {
    const metadata = { title: 'Book', narrator: '' };
    const external = { narrator: 'New Narrator' };

    mergeExternalMetadata(metadata, external);

    expect(metadata.narrator).toBe('New Narrator');
  });

  test('does not set fields to null from external data', () => {
    const metadata = { title: 'Book' };
    const external = { narrator: null, series: undefined };

    mergeExternalMetadata(metadata, external);

    expect(metadata.narrator).toBeUndefined();
    expect(metadata.series).toBeUndefined();
  });

  test('does not set fields to empty string from external data', () => {
    const metadata = { title: 'Book' };
    const external = { narrator: '' };

    mergeExternalMetadata(metadata, external);

    expect(metadata.narrator).toBeUndefined();
  });

  test('handles null external metadata gracefully', () => {
    const metadata = { title: 'Book' };
    const result = mergeExternalMetadata(metadata, null);
    expect(result).toEqual({ title: 'Book' });
  });

  test('handles undefined external metadata gracefully', () => {
    const metadata = { title: 'Book' };
    const result = mergeExternalMetadata(metadata, undefined);
    expect(result).toEqual({ title: 'Book' });
  });

  test('handles non-object external metadata gracefully', () => {
    const metadata = { title: 'Book' };
    const result = mergeExternalMetadata(metadata, 'string');
    expect(result).toEqual({ title: 'Book' });
  });

  test('returns same object reference', () => {
    const metadata = { title: 'Book' };
    const result = mergeExternalMetadata(metadata, { narrator: 'Test' });
    expect(result).toBe(metadata);
  });

  test('handles numeric fields correctly', () => {
    const metadata = { title: 'Book', published_year: null, series_position: null };
    const external = { published_year: 2020, series_position: 3 };

    mergeExternalMetadata(metadata, external);

    expect(metadata.published_year).toBe(2020);
    expect(metadata.series_position).toBe(3);
  });

  test('does not overwrite existing numeric fields', () => {
    const metadata = { title: 'Book', published_year: 2019, series_position: 1 };
    const external = { published_year: 2020, series_position: 3 };

    mergeExternalMetadata(metadata, external);

    expect(metadata.published_year).toBe(2019);
    expect(metadata.series_position).toBe(1);
  });

  test('preserves zero as a valid existing value', () => {
    const metadata = { title: 'Book', series_position: 0 };
    const external = { series_position: 5 };

    mergeExternalMetadata(metadata, external);

    // 0 is falsy but != null, so it should be preserved
    expect(metadata.series_position).toBe(0);
  });
});
