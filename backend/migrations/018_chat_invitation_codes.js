"use strict";

async function up({ execute }) {
  await execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_id_school ON chats(id, school_id)",
  );
  await execute(`
    CREATE TABLE IF NOT EXISTS chat_invitation_codes (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
      use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      FOREIGN KEY (chat_id, school_id)
        REFERENCES chats(id, school_id) ON DELETE CASCADE,
      CHECK (max_uses IS NULL OR use_count <= max_uses)
    )
  `);
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_chat_invitation_codes_active ON chat_invitation_codes(school_id, chat_id, revoked_at, expires_at)",
  );

  // Retire reusable plaintext codes from the legacy chat column.
  await execute("UPDATE chats SET invite_code = NULL WHERE invite_code IS NOT NULL");
}

module.exports = { up };
