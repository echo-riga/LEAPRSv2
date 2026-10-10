This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Connect AI apps to LEAPRS automatically

The public MCP endpoint is `https://leaprs-v2.vercel.app/api/mcp` (replace the domain if deploying elsewhere). The server supports OAuth Dynamic Client Registration (DCR). Each connector registers its own client and callbacks automatically; users do not enter or share server credentials. Registration alone grants no access to LEAPRS data: each user must sign in and approve access.

Server setup:

1. Apply [drizzle/0006_mcp_oauth_grants.sql](drizzle/0006_mcp_oauth_grants.sql) and the security migration if not already applied. Then run `node --use-system-ca scripts/migrate-mcp-clients.mjs` to apply [drizzle/0017_mcp_oauth_clients.sql](drizzle/0017_mcp_oauth_clients.sql). The additive migration preserves existing data.
2. Set `MCP_PUBLIC_URL=https://leaprs-v2.vercel.app` in the deployed app. Use the origin only, without a path or trailing slash. Existing database and Neon Auth settings remain required.
3. Deploy. The manual `MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_CLIENT_SECRET`, and `MCP_OAUTH_REDIRECT_URIS` variables are no longer used and can be removed. Existing manually configured connectors must be re-created with automatic registration; their old tokens no longer authorize MCP access.

User setup:

All active roles can open **LEAPRS Help → Connect to AI Apps** in the portal header to copy the configured MCP URL and read the Claude/ChatGPT setup steps. Actual screenshot assets can be added following `public/mcp-guides/README.md`.

- **Claude:** Customize → Connectors → Add custom connector. Enter the MCP server URL, choose OAuth/sign in, and select **Register automatically** under OAuth client. Do not select a provided client or Claude's published identity: this server supports DCR, not Client ID Metadata Documents (CIMD). Connect, sign in to LEAPRS, and allow access. For Team/Enterprise, an owner may need to add the connector first.
- **ChatGPT:** Plugins → Add custom MCP server. Enter the MCP URL and choose OAuth. In advanced OAuth settings select automatic/dynamic client registration if a client setup choice is shown; leave any provided client ID and secret blank. Create the plugin, sign in to LEAPRS, and allow access. Install/enable the plugin in a conversation.
- **Other clients:** Use a remote HTTP MCP client with OAuth discovery, DCR, and S256 PKCE support. An OAuth-compatible client does not necessarily support automatic registration; verify its capabilities.

Test with: “Use LEAPRS to list my available CapDev projects.” Then test “Use LEAPRS to summarize my requests.” These read-only calls use the connected user's current role and department permissions. The MCP attachment tool accepts file metadata; it does not upload file bytes.

The consent screen shows the client-supplied app name and callback origin so users can check the connection they started. App names are not verified brand identities. Every consent form is bound to the client, callback, PKCE challenge, resource, and state. Registration validates HTTPS callbacks (HTTP is permitted only for local loopback clients), limits metadata size, and uses shared PostgreSQL rate limits. Deploy behind a proxy that overwrites forwarded IP headers, as Vercel does. Confidential client secrets and authorization/access/refresh tokens are stored only as hashes. Access tokens expire after one hour; refresh tokens rotate on use. Archived accounts and non-admin users under maintenance cannot use tools.

Discovery URLs: `/.well-known/oauth-protected-resource/api/mcp` and `/.well-known/oauth-authorization-server`. Authorization metadata advertises `/api/mcp/oauth/register`. An unauthenticated `/api/mcp` request returns `401` with the resource metadata challenge.

Run OAuth checks with `node --use-system-ca --experimental-strip-types --test scripts/mcp-automatic-oauth.test.mjs scripts/mcp-consent.test.mjs`. Database tests use temporary schemas and do not connect to real AI apps.

## Getting Started

Use Node.js 22.15 or newer. Database mutations that require locks use Neon's
WebSocket driver with a connection scoped to each transaction.

After pulling these security changes, apply the additive database migration:

```bash
npm run db:security-migrate
```

The script reads `.env.local`, preserves existing records, and can be rerun.
Existing six-digit verification codes must be requested again because new codes
are stored as keyed hashes. Existing attachment links remain usable; legacy
folder IDs from form JSON are never adopted for deletion. New request folders
are recorded in `request_storage_folders` and checked against the configured
Google Drive root.

Run regression checks with:

```bash
npm run test:security
npm run test:security:db
```

The database tests create a randomly named disposable schema, exercise budget
concurrency and folder ownership, and remove that schema afterward. They do not
modify application records. Verification limits are shared through PostgreSQL;
the deployment proxy must overwrite client-supplied forwarded IP headers.
Expired rows in `security_rate_limits` can be removed periodically.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

### Notification emails

In-app notifications also send individual emails to involved active users' registered
account addresses through Resend. Each user saves their own seven notification-type
preferences in Notifications → Configure Email Notifications; administrators can
open the same preferences from Settings → System Settings. All types default to
enabled. Preferences do not change the in-app filters, verification codes, or
password reset emails. Permissions and preferences are rechecked before sending.

Apply the additive schema before deploying:

```powershell
node --use-system-ca scripts/migrate-notification-email.mjs
```

Existing notifications are excluded from email delivery. New events use durable
per-user delivery records and stable Resend idempotency keys. Provider failures
retry on subsequent notification refreshes or scheduled runs (five attempts, within
20 hours of the first attempt). Email failures do not roll back business actions.
Sent means Resend accepted the message, not guaranteed inbox placement.

Configure server-only `RESEND_API_KEY`, `RESEND_FROM`, and
`APP_URL=https://leaprs-v2.vercel.app` in the deployment environment. On Vercel the
production project URL is also supported as a fallback. Events trigger delivery
after the request completes; portal notification refreshes also drain pending mail.
Inactivity reminders retain their existing on-demand creation behavior.

For reminders and retries while the portal is closed, schedule an authenticated
GET to `/api/notifications/email` with `Authorization: Bearer <CRON_SECRET>`.
Set a separate strong `CRON_SECRET` in the server environment and configure your
scheduler (e.g. Vercel Cron) to invoke the route at the desired interval. The route
creates due reminders and drains up to 20 deliveries per run. No schedule is
enabled by this code alone; choose an interval supported by your hosting plan.

Validate using `node --use-system-ca --experimental-strip-types --test
scripts/notification-email-database.test.mjs scripts/request-reminders-database.test.mjs`.
Tests use disposable database schemas and a mocked email provider.

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
