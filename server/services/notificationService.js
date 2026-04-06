/**
 * Notification Service
 *
 * Generates in-app notifications for library and collection events.
 * Notifications are non-critical — errors are logged but never thrown.
 */
const logger = require('../utils/logger');

const db = require('../database');
const { createDbHelpers } = require('../utils/db');

const { dbRun } = createDbHelpers(db);

/**
 * Create a notification in the database.
 * @param {string} type - Notification type (e.g. 'new_audiobook', 'new_public_collection')
 * @param {string} title - Short notification title
 * @param {string} message - Human-readable notification message
 * @param {Object} [metadata] - Additional data stored as JSON
 */
async function createNotification(type, title, message, metadata) {
  try {
    await dbRun(
      `INSERT INTO notifications (type, title, message, metadata, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [type, title, message, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    logger.error('Failed to create notification:', err.message);
  }
}

/**
 * Notify that a new audiobook was added to the library.
 * @param {Object} audiobook - The audiobook row (from DB or with lastID)
 */
async function notifyNewAudiobook(audiobook) {
  const title = 'New audiobook added';
  const author = audiobook.author || 'Unknown Author';
  const message = `"${audiobook.title}" by ${author} was added to the library`;
  const metadata = { audiobook_id: audiobook.id || audiobook.lastID };

  await createNotification('new_audiobook', title, message, metadata);
}

/**
 * Notify that a new public collection was created.
 * @param {Object} collection - The collection row (must have id, name)
 * @param {string} username - Display name or username of the creator
 */
async function notifyNewPublicCollection(collection, username) {
  const title = 'New public collection';
  const message = `${username} created a public collection: "${collection.name}"`;
  const metadata = { collection_id: collection.id };

  await createNotification('new_public_collection', title, message, metadata);
}

/**
 * Notify that an audiobook was added to a public collection.
 * @param {Object} collection - The collection row (must have id, name)
 * @param {Object} audiobook - The audiobook row (must have id, title)
 * @param {string} username - Display name or username of the user who added it
 */
async function notifyCollectionItemAdded(collection, audiobook, username) {
  const title = 'Book added to collection';
  const message = `${username} added "${audiobook.title}" to "${collection.name}"`;
  const metadata = { collection_id: collection.id, audiobook_id: audiobook.id };

  await createNotification('collection_item_added', title, message, metadata);
}

module.exports = {
  createNotification,
  notifyNewAudiobook,
  notifyNewPublicCollection,
  notifyCollectionItemAdded,
};
