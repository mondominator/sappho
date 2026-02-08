/**
 * Migration: Add FTS5 full-text search for audiobooks
 *
 * Creates an FTS5 virtual table for fast full-text search across
 * title, author, narrator, series, and description fields.
 * Replaces slow LIKE '%term%' queries with indexed FTS5 MATCH.
 *
 * Includes triggers to keep the FTS index in sync with the
 * audiobooks table on INSERT, UPDATE, and DELETE.
 */

function up(db) {
  db.serialize(() => {
    // Create FTS5 virtual table as an external content table
    // backed by the audiobooks table
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS audiobooks_fts USING fts5(
        title, author, narrator, series, description,
        content='audiobooks',
        content_rowid='id'
      )
    `, (err) => {
      if (err) {
        console.error('Error creating audiobooks_fts table:', err.message);
        return;
      }
      console.log('Created audiobooks_fts virtual table');
    });

    // Populate FTS table from existing data
    db.run(`
      INSERT INTO audiobooks_fts(rowid, title, author, narrator, series, description)
      SELECT id, COALESCE(title, ''), COALESCE(author, ''), COALESCE(narrator, ''), COALESCE(series, ''), COALESCE(description, '')
      FROM audiobooks
    `, (err) => {
      if (err) {
        console.error('Error populating audiobooks_fts:', err.message);
      } else {
        console.log('Populated audiobooks_fts from existing data');
      }
    });

    // Trigger: keep FTS in sync on INSERT
    db.run(`
      CREATE TRIGGER IF NOT EXISTS audiobooks_fts_insert
      AFTER INSERT ON audiobooks
      BEGIN
        INSERT INTO audiobooks_fts(rowid, title, author, narrator, series, description)
        VALUES (NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.author, ''), COALESCE(NEW.narrator, ''), COALESCE(NEW.series, ''), COALESCE(NEW.description, ''));
      END
    `, (err) => {
      if (err) {
        console.error('Error creating FTS insert trigger:', err.message);
      } else {
        console.log('Created audiobooks_fts insert trigger');
      }
    });

    // Trigger: keep FTS in sync on DELETE
    db.run(`
      CREATE TRIGGER IF NOT EXISTS audiobooks_fts_delete
      AFTER DELETE ON audiobooks
      BEGIN
        INSERT INTO audiobooks_fts(audiobooks_fts, rowid, title, author, narrator, series, description)
        VALUES ('delete', OLD.id, COALESCE(OLD.title, ''), COALESCE(OLD.author, ''), COALESCE(OLD.narrator, ''), COALESCE(OLD.series, ''), COALESCE(OLD.description, ''));
      END
    `, (err) => {
      if (err) {
        console.error('Error creating FTS delete trigger:', err.message);
      } else {
        console.log('Created audiobooks_fts delete trigger');
      }
    });

    // Trigger: keep FTS in sync on UPDATE
    // For external content FTS5 tables, UPDATE = DELETE old + INSERT new
    db.run(`
      CREATE TRIGGER IF NOT EXISTS audiobooks_fts_update
      AFTER UPDATE ON audiobooks
      BEGIN
        INSERT INTO audiobooks_fts(audiobooks_fts, rowid, title, author, narrator, series, description)
        VALUES ('delete', OLD.id, COALESCE(OLD.title, ''), COALESCE(OLD.author, ''), COALESCE(OLD.narrator, ''), COALESCE(OLD.series, ''), COALESCE(OLD.description, ''));
        INSERT INTO audiobooks_fts(rowid, title, author, narrator, series, description)
        VALUES (NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.author, ''), COALESCE(NEW.narrator, ''), COALESCE(NEW.series, ''), COALESCE(NEW.description, ''));
      END
    `, (err) => {
      if (err) {
        console.error('Error creating FTS update trigger:', err.message);
      } else {
        console.log('Created audiobooks_fts update trigger');
      }
    });
  });
}

function down(db) {
  db.serialize(() => {
    db.run('DROP TRIGGER IF EXISTS audiobooks_fts_insert', (err) => {
      if (err) console.error('Error dropping FTS insert trigger:', err.message);
    });
    db.run('DROP TRIGGER IF EXISTS audiobooks_fts_delete', (err) => {
      if (err) console.error('Error dropping FTS delete trigger:', err.message);
    });
    db.run('DROP TRIGGER IF EXISTS audiobooks_fts_update', (err) => {
      if (err) console.error('Error dropping FTS update trigger:', err.message);
    });
    db.run('DROP TABLE IF EXISTS audiobooks_fts', (err) => {
      if (err) console.error('Error dropping audiobooks_fts:', err.message);
    });
  });
}

module.exports = { up, down };
