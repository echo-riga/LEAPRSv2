CREATE TABLE IF NOT EXISTS "mcp_oauth_grants" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "kind" varchar(16) NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_name" text NOT NULL,
  "user_email" text,
  "client_id" text NOT NULL,
  "redirect_uri" text,
  "code_challenge" text,
  "resource" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "mcp_oauth_grants_user_idx" ON "mcp_oauth_grants" ("user_id");
