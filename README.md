# Studyloop

**Study together. Get there together.**

Studyloop is a browser-based study-partner app for finding students with shared subjects, working together in live rooms, and keeping small study tools close at hand. The frontend is plain HTML, CSS, and JavaScript; the backend is a Node.js/Express API with MongoDB, Redis, and Socket.IO.

> **Project status:** Studyloop has a working local development setup. Before using it with real users, review the deployment and security notes below—particularly cookie behavior, TURN support for calls, account recovery, moderation, and production monitoring.

## Contents

- [Features](#features)
- [Technology and architecture](#technology-and-architecture)
- [Project structure](#project-structure)
- [Run locally](#run-locally)
- [Configuration](#configuration)
- [Tests](#tests)
- [API and real-time overview](#api-and-real-time-overview)
- [Deployment](#deployment)
- [Security, privacy, and known limitations](#security-privacy-and-known-limitations)
- [Feedback and contact](#feedback-and-contact)
- [License](#license)

## Features

- **Accounts and profiles:** Sign up, log in, log out, and edit your display name, study fields, availability, bio, and time zone.
- **Find study partners:** Search and filter member profiles by name, subject, availability, and online presence. Start a one-to-one match for a subject on your profile.
- **Study rooms:** Browse active rooms or create a room for two to four people.
- **Live collaboration:** Chat in a room, see members join and leave, and set a shared study goal. Room chat and session history are saved by the backend.
- **Optional audio and video:** Browser WebRTC streams media peer-to-peer after a user grants permission. The API handles room access and relays WebRTC signaling; it does not host the media stream.
- **Study tools:** Save account-linked notes (up to 500 characters) and flashcards. A 25-minute focus timer and a drawing whiteboard are also included.
- **Responsive interface:** Plain HTML/CSS/JavaScript frontend with separate sign-up and login pages.

The focus timer and whiteboard are browser-side tools. Whiteboard drawings are **not** saved or shared. Notes and flashcards are account-specific and stored through the API.

## Technology and architecture

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | HTML, CSS, vanilla JavaScript | Pages, account flows, dashboard, REST client, Socket.IO client, browser WebRTC |
| API | Node.js 20+, Express 5 | Authentication, profiles, matchmaking, rooms, study tools, health checks |
| Persistent storage | MongoDB replica set | Users, rooms, sessions, chat messages, notes, and flashcards |
| Shared/ephemeral state | Redis 7+ | Presence, matchmaking queues, active-room indexes, rate limits, locks, refresh-token state |
| Real-time transport | Socket.IO with Redis adapter | Presence, room events, chat, media state, and WebRTC signaling |
| Local development | Docker Compose | MongoDB replica set, Redis, and API containers |

```text
Browser
  ├── REST requests ────────────────┐
  ├── Socket.IO events ─────────────┤──> Express API ──> MongoDB replica set
  └── WebRTC peer media ────────────┘         └────────> Redis
             (after permission)                └────────> Socket.IO Redis adapter
```

MongoDB is the source of truth for saved records. Redis coordinates state that needs to be shared or expire quickly, such as online presence and matchmaking. The browser creates the WebRTC peer connections; the backend authorizes room signaling and relays offers, answers, and ICE candidates.

## Project structure

```text
.
├── index.html                 # Protected Studyloop dashboard
├── login.html                 # Login page
├── signup.html                # Account registration page
├── styles.css                 # Main site styles
├── auth.css                   # Authentication and shared styles
├── api.js                     # REST client, access-token handling, refresh flow
├── auth.js                    # Login/signup forms and dashboard session guard
├── app.js                     # Profiles, matchmaking, rooms, chat, and call UI
├── realtime.js                # Socket.IO client and events
├── study-tools.js             # Timer, account notes/flashcards, browser whiteboard
├── .gitignore                 # Repository ignore rules
├── .vercelignore              # Exclusions for the static Vercel deployment
├── README.md
└── backend/
    ├── .env.example           # Local configuration template; safe to commit
    ├── Dockerfile
    ├── docker-compose.yml     # Local-only MongoDB, Redis, and API stack
    ├── package.json
    ├── package-lock.json
    ├── README.md              # Detailed REST and Socket.IO reference
    ├── test/
    └── src/
        ├── app.js              # Express middleware, health checks, API routes
        ├── server.js           # Startup, indexes, Socket.IO, shutdown
        ├── config/             # Environment, MongoDB, Redis, and CORS
        ├── controllers/        # HTTP handlers
        ├── middleware/         # Authentication, rate limits, errors
        ├── models/             # MongoDB models
        ├── routes/             # REST routes
        ├── services/           # Business logic and persistence
        ├── sockets/            # Socket.IO authentication and events
        └── utils/              # Validation, errors, serializers
```

## Run locally

### Requirements

- Docker Desktop or Docker Engine with the Docker Compose plugin
- A modern browser
- Python 3 for the static frontend server (or another local HTTP server)
- Node.js 20+ only if you want to run the API directly outside Docker

Use an HTTP server rather than opening the HTML files with `file://`. The local URLs below are `http://localhost`, which browsers treat as a secure context for camera and microphone permissions.

### 1. Start the backend and local data services

```bash
cd backend
cp .env.example .env   # first run only
# Optional: change the development JWT values in .env.
docker compose up --build
```

Compose starts the API on port `4000`, MongoDB 7 as a single-node replica set, and Redis 7. The replica set is needed for the backend's room/session transactions. The development template already allows the frontend origins on ports `3000`, `4173`, and `8000`.

Wait for the API to become ready:

```bash
curl http://localhost:4000/health/ready
```

A ready response reports both MongoDB and Redis as `up`.

### 2. Serve the frontend

In a second terminal, from the repository root:

```bash
python3 -m http.server 3000
```

Open **http://localhost:3000/signup.html** to create an account, or **http://localhost:3000/login.html** to sign in. The dashboard is `index.html`; it requires an authenticated session.

The pages currently point to the local API at `http://localhost:4000`. If you serve the frontend from another host or port, add that exact origin to `CORS_ORIGINS` in `backend/.env` and restart the API. Origins are comma-separated and should not include a trailing slash.

### 3. Try the app

1. Create an account. Passwords must be at least 12 characters.
2. Your account opens the protected dashboard, where you can edit your profile and search for members.
3. For a one-to-one match, use an eligible subject from your profile. Create a second account in a separate browser profile to test matching between two users.
4. Create a study room to try group rooms, saved chat, and shared goals.
5. Turn on a microphone or camera only if you want to; the browser will request permission.

### Stop the services

Stop the Compose stack with `Ctrl+C` in the terminal running Compose, or run this from `backend/`:

```bash
docker compose down
```

Named Docker volumes preserve local MongoDB and Redis data. **To permanently remove that local data**, run `docker compose down -v` from `backend/`.

### Run the API directly with Node (optional)

Use this mode if you want Node's watch mode while MongoDB and Redis remain in Docker. Make sure a replica-set MongoDB and Redis are reachable at the URLs in `.env` first:

```bash
cd backend
cp .env.example .env   # first run only
docker compose up -d mongo redis
npm ci
npm run dev
```

If you previously started the complete Compose stack, its API container may already own port `4000`. Stop only that API container before starting Node directly:

```bash
docker compose stop api
```

Keep the MongoDB and Redis containers running. The Node API listens on the port configured by `PORT` (default `4000`).

## Configuration

Copy `backend/.env.example` to `backend/.env` for local development. The actual `.env` is ignored by Git; keep real credentials out of the repository and enter production values in the hosting provider's environment-variable settings.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Runtime mode; use `production` when deployed. |
| `PORT` | API port; defaults to `4000`. The server binds to `0.0.0.0`. |
| `TRUST_PROXY` | Number of trusted reverse-proxy hops. Set appropriately behind a hosting proxy. |
| `MONGO_URI` | MongoDB connection string. Room/session transactions require a replica set. |
| `REDIS_URL` | Redis connection string. Use the TLS URL provided by your managed Redis service when required (often `rediss://`). |
| `JWT_ACCESS_SECRET` | Secret for short-lived access tokens; must be at least 32 characters. |
| `JWT_REFRESH_SECRET` | Separate secret for refresh tokens; must be at least 32 characters and differ from the access secret. |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Issuer and audience used when validating JWTs. |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | Access- and refresh-token lifetimes; defaults are `15m` and `7d`. |
| `CORS_ORIGINS` | Comma-separated, exact browser origins allowed to call the API. |
| `COOKIE_SECURE` | Set to `true` for HTTPS deployments. Defaults to `true` when `NODE_ENV=production`. |
| `COOKIE_SAME_SITE` | `lax`, `strict`, or `none`. `none` requires `COOKIE_SECURE=true`. |
| `ROOM_CAPACITY_MAX` | Maximum user-created room capacity; allowed range is 2–4. |
| `MATCH_QUEUE_TTL_SECONDS` | Matchmaking queue expiry; defaults to 180 seconds. |
| `PRESENCE_LEASE_MS`, `PRESENCE_HEARTBEAT_MS` | Online-presence lease and heartbeat timing. |

The local `.env.example` contains development-only values. Before deployment, generate two independent random secrets. For example, run this command twice and use the two different outputs in the hosting dashboard:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Never reuse the example secrets in production and never commit `backend/.env`.

## Tests

There is no root-level frontend build step. Backend scripts are run from `backend/`:

```bash
npm ci
npm test
npm run check
```

- `npm run dev` — start the API with Node watch mode.
- `npm start` — start the API in production mode.
- `npm test` — run the Node.js test suite.
- `npm run check` — syntax-check the backend server entry point.

For a quick syntax check of the browser JavaScript, run from the repository root:

```bash
node --check api.js
node --check auth.js
node --check app.js
node --check realtime.js
node --check study-tools.js
```

The included automated tests currently focus on validation helpers; they are not a substitute for end-to-end tests with MongoDB, Redis, Socket.IO, and a real browser.

## API and real-time overview

The REST API is mounted at `/api`. Authenticated REST requests use a short-lived bearer access token. The frontend keeps that token in memory and sends the HttpOnly refresh cookie with credentialed requests.

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/register` and `POST /api/auth/login` | Create an account or sign in |
| `POST /api/auth/refresh` and `POST /api/auth/logout` | Refresh the session or sign out |
| `/api/users` and `/api/users/me` | Search public profiles or read/update your own profile |
| `/api/matchmaking` | Join, check, or cancel a subject/availability match queue |
| `/api/rooms` | List, create, join, and leave study rooms |
| `/api/rooms/:roomId/messages` | Read saved messages for a room participant |
| `/api/sessions/me` | Read your study-session history |
| `/api/study-tools/notes/me` | Read or save your account note |
| `/api/study-tools/flashcards` | List, create, or delete your flashcards |
| `/health/live`, `/health/ready` | Liveness and MongoDB/Redis readiness checks |

Socket.IO handles presence, room membership events, matchmaking notifications, chat, media-state updates, shared goals, and WebRTC signaling. The full request/response contracts, payloads, event names, Redis design, and WebRTC flow are documented in [`backend/README.md`](backend/README.md).

## Deployment

A practical deployment layout for this project is:

```text
Vercel (static HTML/CSS/JS)
          │ REST + Socket.IO over HTTPS
          ▼
Render (long-running Express/Socket.IO API)
          ├── MongoDB Atlas (replica set)
          └── Managed Redis (for example, Upstash)
```

The frontend is a static site. The Express/Socket.IO backend is a persistent service and should be deployed separately; do not treat the static Vercel site as a replacement for the long-running backend.

### Frontend on Vercel

1. Import the repository into Vercel and select the repository root as the project root.
2. Select the **Other** framework preset. There is no frontend build command; configure the static output to serve the repository root if Vercel asks for an output directory.
3. The root `.vercelignore` excludes backend source, local uploads, dependencies, environment files, and the README from the static deployment package. The backend remains in the Git repository for its separate deployment.
4. After the API is deployed, replace the `studyloop-api-url` meta value in **all three** pages—`index.html`, `login.html`, and `signup.html`—with the Render API origin, for example `https://your-api.onrender.com` (no trailing slash). `api.js` uses this setting for both REST and Socket.IO.

### Backend on Render

1. Create a Render Web Service for the repository and set its root directory to `backend`.
2. For a Node service, use `npm ci` as the build command and `npm start` as the start command. The included `backend/Dockerfile` can also be used for a Docker-based service.
3. Configure the production environment variables in Render: `NODE_ENV=production`, `MONGO_URI`, `REDIS_URL`, separate strong JWT secrets, the exact frontend origin in `CORS_ORIGINS`, and appropriate proxy/cookie settings.
4. Use a MongoDB replica set—MongoDB Atlas is suitable—and managed Redis. Restrict database access to the API service where your providers allow it; enable TLS and authentication.
5. Verify `https://your-api.onrender.com/health/ready` reports MongoDB and Redis as ready.

### Production cookies and domains

The refresh token is held in an HttpOnly cookie. The browser also needs credentialed CORS requests, so configure the exact frontend origin and allow credentials through the backend's existing CORS setup. Use HTTPS and set `COOKIE_SECURE=true`.

If the frontend and API are on different sites (for example, `*.vercel.app` and `*.onrender.com`), the cookie generally needs `COOKIE_SAME_SITE=none`. Browser privacy settings can still block cross-site cookies. For a more reliable production session, use custom frontend and API subdomains on the same site, such as `study.example.com` and `api.example.com`, and test login/refresh in the browsers you support.

Do not put MongoDB, Redis, JWT, or TURN credentials in HTML, JavaScript, GitHub, or Vercel's static files. Store secrets in the backend host's environment settings. For reliable audio/video across restrictive networks, configure a TURN service; the current browser RTC configuration includes STUN but no TURN service.

## Security, privacy, and known limitations

- Passwords are handled by the backend; public profile responses do not include a member's email or password.
- Access tokens are kept in browser memory, not `localStorage`. The refresh token is an HttpOnly cookie.
- Microphone and camera are off until a member chooses to enable them and grants browser permission. WebRTC media is peer-to-peer when possible; a TURN relay, if configured, may relay media.
- `backend/docker-compose.yml` is for local development only. It exposes local MongoDB and Redis ports without production database credentials; do not expose that setup publicly.
- The app does not currently include email verification, forgotten-password recovery, account deletion, report/block workflows, or a full moderation system. Add and review these before a broad public launch.
- The included WebRTC setup has no TURN credentials or TURN service. Calls may fail for users behind restrictive NATs or firewalls until TURN is configured.
- The whiteboard and focus timer are browser-side tools; whiteboard drawings are not synchronized or saved.
- Back up production databases, monitor logs and health checks, restrict database network access, and test the deployment with real browsers. The validation test suite does not provide full integration or load coverage.

## Feedback and contact

Have feedback, a feature idea, or a request for a change or update? You can reach Mohsin Ali here:

- Email: [mohsinalijoo@gmail.com](mailto:mohsinalijoo@gmail.com)
- LinkedIn: [linkedin.com/in/mohsinalijoo](https://www.linkedin.com/in/mohsinalijoo/)
- Phone: [+91 9541855245](tel:+919541855245)

## License

No `LICENSE` file is currently included in this repository. Unless a license is added, the project remains under its default copyright; do not assume the code is licensed for reuse.

**© 2026 Studyloop by Mohsin Ali**
