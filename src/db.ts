import Database from 'better-sqlite3';
import * as path from 'path';
import { Group } from './types';

const dbPath = path.resolve(process.cwd(), 'facebook.db');
const db = new Database(dbPath);

// Enable Foreign Key support
db.pragma('foreign_keys = ON');

/**
 * Initialize SQLite database tables.
 */
export function initDb() {
  // Create groups table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT NOT NULL,
      group_url TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
      last_posted_at TEXT
    )
  `).run();

  // Create posts_history table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS posts_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      post_content TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(group_id) REFERENCES groups(id)
    )
  `).run();

  // Migration: Automatically fix legacy web.facebook.com domains in existing DB rows
  db.prepare(`
    UPDATE groups 
    SET group_url = REPLACE(group_url, 'web.facebook.com', 'www.facebook.com')
    WHERE group_url LIKE '%web.facebook.com%'
  `).run();
}

/**
 * Fetch all groups with 'active' status.
 */
export function getActiveGroups(): Group[] {
  const stmt = db.prepare("SELECT * FROM groups WHERE status = 'active'");
  return stmt.all() as Group[];
}

/**
 * Update the last_posted_at timestamp of a group.
 */
export function updateGroupLastPosted(groupId: number, lastPostedAt: string) {
  db.prepare("UPDATE groups SET last_posted_at = ? WHERE id = ?").run(lastPostedAt, groupId);
}

/**
 * Add a log to the posts_history table.
 */
export function addPostHistory(
  groupId: number,
  postContent: string,
  status: 'success' | 'failed',
  errorMessage: string | null = null
) {
  db.prepare(`
    INSERT INTO posts_history (group_id, post_content, status, error_message)
    VALUES (?, ?, ?, ?)
  `).run(groupId, postContent, status, errorMessage);
}

/**
 * Check total count of groups in the database.
 */
export function getGroupCount(): number {
  const result = db.prepare("SELECT COUNT(*) as count FROM groups").get() as { count: number };
  return result.count;
}

/**
 * Seed database with initial groups.
 */
export function seedGroups(groups: { name: string; url: string }[]) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO groups (group_name, group_url, status)
    VALUES (?, ?, 'active')
  `);

  const transaction = db.transaction((groupList) => {
    for (const group of groupList) {
      insert.run(group.name, group.url);
    }
  });

  transaction(groups);
}

/**
 * Close database connection safely.
 */
export function closeDb() {
  db.close();
}
