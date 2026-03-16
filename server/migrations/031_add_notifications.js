function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function up(db) {
  await runSql(db, `
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runSql(db, `
    CREATE TABLE IF NOT EXISTS user_notification_reads (
      user_id INTEGER NOT NULL,
      notification_id INTEGER NOT NULL,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, notification_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
    )
  `);

  await runSql(db, `
    CREATE INDEX IF NOT EXISTS idx_notifications_created_at
    ON notifications(created_at DESC)
  `);

  await runSql(db, `
    CREATE INDEX IF NOT EXISTS idx_notifications_type
    ON notifications(type)
  `);

  console.log('Added notifications and user_notification_reads tables');
}

async function down(db) {
  await runSql(db, 'DROP TABLE IF EXISTS user_notification_reads');
  await runSql(db, 'DROP TABLE IF EXISTS notifications');
  console.log('Removed notifications tables');
}

module.exports = { up, down };
