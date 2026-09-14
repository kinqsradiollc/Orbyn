# Orbyn

**From orbit.** Your tasks, deadlines, events, and life revolve around one intelligent system.

Orbyn is a planner with a web/desktop app, a native mobile app, and a separate backend. An AI
assistant (any OpenAI-compatible provider) can summarize your planner and propose creates,
updates, and deletes that you approve before they are saved. A background worker sends in-app,
email, and mobile push reminders as deadlines approach.

## Repository layout

| Directory  | What it is                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------- |
| `backend/` | Fastify + PostgreSQL API, reminder worker, migrations, Dockerfile. Node 22, TypeScript.       |
| `desktop/` | React + Vite web app, also packaged as an Electron desktop app. Served by nginx in Docker.    |
| `mobile/`  | Expo (React Native) app for iOS and Android with secure session storage and Expo push tokens. |
| `docs/`    | Setup, architecture, API reference, deployment, and mobile guides.                            |

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up -d --build
```

Then open:

| Service        | URL                     |
| -------------- | ----------------------- |
| Web app        | <http://localhost:8080> |
| API            | <http://localhost:8008> |
| Mailpit (mail) | <http://localhost:8025> |

Create an account in the web app, add a task with a due date, and a reminder lands in Mailpit
and in the in-app notification tray when the reminder window opens.

To enable the AI assistant, set `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` in `.env` and run
`docker compose up -d` again. Any provider that speaks the OpenAI chat completions API works
(OpenAI, Azure OpenAI, OpenRouter, Groq, Together, Ollama, vLLM, LM Studio, and so on).

## Quick start (local development)

```bash
cp .env.example .env
docker compose up -d postgres mailpit
npm install
npm run migrate -w backend
npm run dev -w backend        # API on http://localhost:8000
npm run dev                   # web app on http://localhost:5173 (proxies /api to the backend)
```

For the reminder worker in development:

```bash
npm run build -w backend && npm run worker -w backend
```

For mobile, see [docs/mobile.md](docs/mobile.md).

## Documentation

- [Setup guide](docs/setup.md) - every environment variable, Docker and local workflows
- [Architecture](docs/architecture.md) - services, data model, reminder pipeline, AI proposal flow
- [API reference](docs/api.md) - all HTTP endpoints
- [Mobile guide](docs/mobile.md) - running on a device, push notifications, EAS builds
- [Deployment](docs/deployment.md) - production checklist

## Scripts

| Command                      | Purpose                                             |
| ---------------------------- | --------------------------------------------------- |
| `npm run typecheck`          | Type-check backend and desktop                      |
| `npm test`                   | Backend integration tests (needs `orbyn_test` DB)   |
| `npm run build`              | Build backend and desktop                           |
| `npm run format`             | Format all sources with Prettier                    |
| `npm run dev`                | Start the web app dev server                        |
| `npm run desktop -w desktop` | Launch the Electron shell against the built web app |
| `npm run package -w desktop` | Produce installers (dmg, nsis, AppImage)            |

## Tests

The backend suite uses a real PostgreSQL database and refuses to run against anything not named
`orbyn_test`:

```bash
docker run -d --name orbyn-test-postgres -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=orbyn -e POSTGRES_PASSWORD=orbyn-test -e POSTGRES_DB=orbyn_test postgres:17-alpine
DATABASE_URL=postgres://orbyn:orbyn-test@127.0.0.1:55432/orbyn_test npm test
```
