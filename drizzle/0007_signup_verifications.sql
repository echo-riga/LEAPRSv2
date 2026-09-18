CREATE TABLE IF NOT EXISTS "signup_verifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" varchar(255) NOT NULL,
  "code" varchar(10) NOT NULL,
  "expires_at" timestamp NOT NULL,
  "is_verified" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "signup_verifications_email_idx" ON "signup_verifications" ("email");
