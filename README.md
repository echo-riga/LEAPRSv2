This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Connect Claude web to LEAPRS

The MCP endpoint is `https://YOUR-LEAPRS-DOMAIN/api/mcp`. Claude connects from Anthropic's cloud, so deploy the app at a public HTTPS address. It cannot connect to `localhost` or a private LAN address.

1. Apply [drizzle/0006_mcp_oauth_grants.sql](drizzle/0006_mcp_oauth_grants.sql) to the same database as LEAPRS (or apply the schema with `npm run db:push`).
2. Set these environment variables on the deployed app:

   ```text
   MCP_PUBLIC_URL=https://YOUR-LEAPRS-DOMAIN
   MCP_OAUTH_CLIENT_ID=leaprs-claude
   MCP_OAUTH_CLIENT_SECRET=<a-long-random-secret>
   MCP_OAUTH_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback
   ```

   `MCP_PUBLIC_URL` is the origin only, with no path or trailing slash. Generate a unique client secret, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Keep it in the server environment and Claude connector settings; do not put it in `NEXT_PUBLIC_*` variables. Redeploy after setting them.
3. In Claude web, open **Customize → Connectors → + → Add custom connector**. Enter the MCP URL above. Under **Advanced settings**, enter the same OAuth client ID and secret, then add the connector. For Team or Enterprise, an owner adds it in **Organization settings → Connectors** first.
4. Click **Connect**, sign in to LEAPRS if prompted, and approve the consent screen. Enable the connector in the conversation's **+ → Connectors** menu.

OAuth grants carry the signed-in user's identity; each tool call checks the current LEAPRS role, department, and maintenance setting. Access tokens expire after one hour, and refresh tokens rotate on use. The connector can submit requests, so approve its actions in Claude deliberately.

To check discovery after deployment, open `https://YOUR-LEAPRS-DOMAIN/.well-known/oauth-protected-resource/api/mcp` and `https://YOUR-LEAPRS-DOMAIN/.well-known/oauth-authorization-server`. An unauthenticated request to `/api/mcp` should return `401` with a `WWW-Authenticate` header pointing to the protected resource metadata.

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
