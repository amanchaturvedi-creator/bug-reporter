# Bugs Reporter

Slack bot that watches a channel for bug reports (emoji :bug: or keywords) and creates tickets in your self-hosted Plane (e.g. [plan.driffle.org](https://plan.driffle.org/driffle/)).

## Local setup (test before you push)

### 1. Start Postgres and Redis

From the project root:

```bash
docker compose up -d
```

This starts:

- **Postgres** on `localhost:5432` (user `bugs`, password `bugs`, db `bugs_reporter`)
- **Redis** on `localhost:6379`

### 2. Backend env and DB

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` and set at least:

- **Database** (already correct for local if you use docker-compose):
  - `DATABASE_URL=postgresql://bugs:bugs@localhost:5432/bugs_reporter`
- **Redis** (already correct for local):
  - `REDIS_HOST=localhost`
  - `REDIS_PORT=6379`

For **Slack** and **Plane** you can leave placeholders to only test that the app starts; add real values when you want to test the full flow.

```bash
# Install deps and run migrations
npm install
npx prisma generate
npx prisma migrate deploy   # or: npm run prisma:migrate

# Optional: seed (no required data)
npm run prisma:seed
```

### 3. Run the backend locally

```bash
npm run start:dev
```

You should see the app listening on `http://localhost:3000`. The Slack Events URL you’ll configure later is:

`http://localhost:3000/slack/events`

For Slack to reach this on your machine you need a public URL (e.g. ngrok):

```bash
ngrok http 3000
# Use the https URL + /slack/events as Request URL in Slack
```

### 4. When you’re ready to test with Slack and Plane

1. **Slack**
   - Create an app at [api.slack.com/apps](https://api.slack.com/apps).
   - Bot token (e.g. `xoxb-...`) → `SLACK_BOT_TOKEN`.
   - Signing Secret (Basic Information) → `SLACK_SIGNING_SECRET`.
   - Subscribe to **message.channels** (Event Subscriptions), Request URL = your public URL + `/slack/events`.
   - Invite the bot to the channel you want to monitor and set that channel ID as `CHANNEL_ID`.

2. **Plane (self-hosted)**
   - `PLANE_BASE_URL=https://plan.driffle.org` (your instance).
   - `PLANE_WORKSPACE_SLUG=driffle` (from your URL path).
   - Create an API key in Plane and set `PLANE_API_KEY`.
   - Set `PLANE_PROJECT_ID` to the project where bugs should be created.

3. Restart the backend and post a message in the Slack channel with :bug: or words like “bug”, “issue”, “error”, “broken” to trigger a ticket.

## Environment variables (reference)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `REDIS_HOST`, `REDIS_PORT` | Yes | Redis for BullMQ |
| `SLACK_BOT_TOKEN` | For Slack | Bot token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | For Slack | Signing secret for request verification |
| `CHANNEL_ID` | For Slack | Slack channel ID to monitor (e.g. #production-issues) |
| `PLANE_BASE_URL` | For Plane | Your Plane base URL (e.g. https://plan.driffle.org) |
| `PLANE_API_KEY` | For Plane | Plane API key |
| `PLANE_WORKSPACE_SLUG` | For Plane | Workspace slug (e.g. driffle) |
| `PLANE_PROJECT_ID` | For Plane | Project ID where issues are created |
| `OPENAI_API_KEY` | Optional | For AI-generated titles and severity |

## Deploy later

- Use the same `DATABASE_URL` and Redis in production.
- Point Slack Event Subscriptions to your production URL (e.g. `https://your-domain.com/slack/events`).
- Keep `PLANE_BASE_URL` and other Plane vars as needed for your self-hosted Plane.

### Railway (fix: `Cannot find module '/app/dist/main'`)

That error means the **build step never produced `dist/`** before `node` ran. Do one of the following:

1. **Dockerfile (recommended)**  
   - Use the `Dockerfile` at the **repo root** or `backend/Dockerfile` if the service root is `backend`.  
   - In Railway: **Settings → Build → Builder = Dockerfile**, and set **Dockerfile path** if needed (`Dockerfile` or `backend/Dockerfile`).  
   - The image runs `npm ci` → `npm run build` → starts with `prisma migrate deploy` + `node dist/main.js`.

2. **Nixpacks (no Docker)**  
   - Set **Root Directory** to `backend` so `package.json` and `npm run build` are found.  
   - `backend/nixpacks.toml` runs `npm ci` and `npm run build` before `npm start`.  
   - Ensure **Build Command** is `npm run build` (or leave empty so Nixpacks uses the config).

3. **Scripts**  
   - `npm start` runs migrations then `node dist/main.js`. You must run **`npm run build`** in the build phase (Dockerfile and `nixpacks.toml` do this).

Set `REDIS_HOST` / `REDIS_PORT` (and password if any) for BullMQ when deploying.

## Scripts (backend)

- `npm run start:dev` — run with watch (local)
- `npm run build` / `npm run start:prod` — production
- `npm run prisma:migrate` — run migrations
- `npm run prisma:studio` — open Prisma Studio on the DB
