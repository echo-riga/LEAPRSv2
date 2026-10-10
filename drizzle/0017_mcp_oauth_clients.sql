CREATE TABLE IF NOT EXISTS "mcp_oauth_clients" (
  "client_id" text PRIMARY KEY NOT NULL,
  "client_name" text NOT NULL,
  "redirect_uris" jsonb NOT NULL,
  "token_endpoint_auth_method" varchar(32) NOT NULL,
  "client_secret_hash" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_client_redirects_check" CHECK (jsonb_typeof("redirect_uris") = 'array'),
  CONSTRAINT "mcp_client_auth_check" CHECK (
    ("token_endpoint_auth_method" = 'none' AND "client_secret_hash" IS NULL) OR
    ("token_endpoint_auth_method" IN ('client_secret_basic', 'client_secret_post') AND "client_secret_hash" IS NOT NULL)
  )
);
