# Rail Live Todo

A real-time collaborative Todo application built with Rails 8.1 and React 19, featuring live updates across multiple browser tabs using a leader election pattern.

## Features

- Create, update, toggle, and delete todos
- Real-time synchronization via ActionCable WebSockets
- **Leader election system** - Only one browser tab maintains a WebSocket connection, reducing server load while other tabs receive updates via BroadcastChannel API
- Server-side rendering with Inertia.js
- All-SQLite architecture (no Redis or PostgreSQL required)

## Tech Stack

### Backend
- Ruby 4.0.1
- Rails 8.1.2
- SQLite3 (primary database, cache, queue, and cable)
- Solid Cache, Solid Queue, Solid Cable
- Puma web server

### Frontend
- React 19
- Inertia.js
- Jotai (state management)
- Vite (build tooling)

## System Dependencies

- Ruby 4.0.1
- Node.js (for frontend build)
- SQLite3 >= 2.1

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SOLID_QUEUE_IN_PUMA` | Run Solid Queue inside Puma process | `false` |
| `RAILS_ENV` | Application environment | `development` |

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd rail-live-todo
   ```

2. Install Ruby dependencies:
   ```bash
   bundle install
   ```

3. Install JavaScript dependencies:
   ```bash
   npm install
   ```

4. Setup the database:
   ```bash
   bin/rails db:setup
   ```

## Running the Application

### Development

Start the Rails server with Vite:

```bash
bin/dev
```

This starts:
- Rails server on `http://localhost:3000`
- Vite dev server for hot module replacement

### Production

The app uses Kamal for deployment. Key configuration is in `config/deploy.yml`.

```bash
bin/kamal deploy
```

**Useful Kamal commands:**
```bash
bin/kamal console  # Rails console
bin/kamal shell    # Bash shell
bin/kamal logs     # Tail logs
bin/kamal dbc      # Database console
```

## Database

### Schema

The application has a single `todos` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `title` | string | Todo title (required) |
| `completed` | boolean | Completion status (default: false) |
| `created_at` | datetime | Creation timestamp |
| `updated_at` | datetime | Update timestamp |

### Production Databases

In production, SQLite databases are stored in `storage/`:
- `production.sqlite3` - Primary database
- `production_cache.sqlite3` - Solid Cache
- `production_queue.sqlite3` - Solid Queue
- `production_cable.sqlite3` - Solid Cable

## API Endpoints

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/` | Render todos page | Inertia page |
| `GET` | `/todos` | List all todos | Inertia page |
| `POST` | `/todos` | Create a todo | JSON |
| `PATCH` | `/todos/:id` | Update a todo | JSON |
| `DELETE` | `/todos/:id` | Delete a todo | 204 No Content |
| `GET` | `/up` | Health check | 200 OK |

## Testing

### Run the Test Suite

```bash
# Run all tests
bin/rails test

# Run system tests
bin/rails test:system

# Run tests in parallel
bin/rails test:all
```

### Test Framework

- Minitest (Rails default)
- Capybara + Selenium for system tests
- Parallel test execution enabled

## Services

### Background Jobs (Solid Queue)

Jobs are processed via Solid Queue using SQLite as the backend.

**Jobs:**
- `BroadcastTodosJob` - Broadcasts todo updates to all connected WebSocket clients

**Running the queue:**
```bash
# Standalone
bin/rails solid_queue:start

# Or inside Puma (set SOLID_QUEUE_IN_PUMA=true)
```

### Caching (Solid Cache)

Database-backed caching with SQLite:
- Max size: 256MB
- Todo list cached with key `todos:broadcast_list` (1-hour TTL)

### Real-Time Updates (ActionCable + Solid Cable)

- Development: Async adapter (in-process)
- Production: Solid Cable (SQLite-backed, 0.1s polling)

**WebSocket Channel:** `TodosChannel`
- Streams from `"todos"`
- Sends cached todos on subscription for instant UI hydration

## Architecture

### Leader Election Pattern

To reduce server load, only one browser tab (the "leader") maintains a WebSocket connection:

1. Tabs communicate via BroadcastChannel API
2. Leader sends heartbeat every 2 seconds
3. Follower becomes leader after 5 seconds of no heartbeat
4. Lower tab ID wins conflicts
5. Followers receive data broadcasts from the leader

### Frontend Structure

```
app/javascript/
├── atoms/          # Jotai state atoms
├── channels/       # ActionCable consumer
├── components/     # React components
├── entrypoints/    # Vite entry points
├── hooks/          # Custom React hooks
└── pages/          # Inertia pages
```

**Key Hooks:**
- `useTodoSync.js` - Manages todo synchronization
- `useLeaderElection.js` - Leader election across tabs

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs:

1. **Security Scan** - Brakeman + bundler-audit
2. **JS Audit** - Importmap vulnerability check
3. **Lint** - RuboCop
4. **Test** - Rails tests
5. **System Test** - Capybara tests with screenshot artifacts on failure

## Development

### Code Style

- Ruby: RuboCop with Rails Omakase style
- Run linting: `bin/rubocop`

### Security Scanning

```bash
# Ruby security scan
bin/brakeman

# Gem vulnerability audit
bundle exec bundler-audit check --update
```

## Browser Support

Modern browsers only (enforced via `allow_browser versions: :modern` in ApplicationController).

## License

[Add your license here]
