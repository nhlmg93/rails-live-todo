# Real-Time Updates Documentation

This document provides a comprehensive guide to the real-time synchronization feature in this Rails + React application. The system uses ActionCable WebSockets with an intelligent tab leader election pattern to efficiently sync data across multiple browser tabs.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [How It Works](#how-it-works)
3. [Backend Implementation](#backend-implementation)
4. [Frontend Implementation](#frontend-implementation)
5. [Data Flow Examples](#data-flow-examples)
6. [Solid Queue & Solid Cache](#solid-queue--solid-cache)
7. [Thruster (Production HTTP Proxy)](#thruster-production-http-proxy)
8. [Configuration](#configuration)
9. [File Reference](#file-reference)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           BROWSER                                    │
│  ┌──────────────────┐    BroadcastChannel    ┌──────────────────┐   │
│  │   LEADER TAB     │ ──────────────────────▶│  FOLLOWER TAB    │   │
│  │                  │                        │                  │   │
│  │  ┌────────────┐  │                        │  ┌────────────┐  │   │
│  │  │ WebSocket  │  │                        │  │  No WS     │  │   │
│  │  │ Connection │  │                        │  │  Needed    │  │   │
│  │  └─────┬──────┘  │                        │  └────────────┘  │   │
│  └────────┼─────────┘                        └──────────────────┘   │
└───────────┼─────────────────────────────────────────────────────────┘
            │ ActionCable WebSocket
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         RAILS SERVER                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐   │
│  │ TodosChannel │◀───│ Solid Queue  │◀───│ TodosController      │   │
│  │              │    │ (async jobs) │    │ (CRUD operations)    │   │
│  └──────────────┘    └──────────────┘    └──────────────────────┘   │
│         │                   │                      │                │
│         ▼                   ▼                      ▼                │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                     Rails Cache                              │    │
│  │                  (Todo.broadcast_list)                       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    SQLite Database                           │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Role |
|-----------|------|
| **Leader Tab** | Maintains WebSocket connection, receives server updates, relays to followers |
| **Follower Tabs** | Receive updates via BroadcastChannel (no WebSocket overhead) |
| **TodosChannel** | ActionCable channel that broadcasts todo updates |
| **BroadcastTodosJob** | Background job that fetches and broadcasts data |
| **Rails Cache** | Caches `Todo.broadcast_list` to avoid repeated DB queries |
| **Solid Queue** | SQLite-backed job queue for async processing |

---

## How It Works

### Leader Election Algorithm

The system uses the [BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) to elect a single "leader" tab that maintains the WebSocket connection:

1. **Discovery Phase**: When a new tab opens, it sends a `discover` message
2. **Response**: If a leader exists, it responds with a `ping`
3. **Election**: If no response within 500ms, the tab becomes leader
4. **Heartbeat**: Leader sends `ping` every 2 seconds
5. **Failover**: If heartbeats stop for 5 seconds, a follower becomes leader
6. **Tiebreaker**: If multiple leaders exist, lowest `TAB_ID` wins

```javascript
// Message types in BroadcastChannel
{ type: 'discover', from: TAB_ID }  // New tab asking for leader
{ type: 'ping', from: TAB_ID }      // Leader heartbeat
{ type: 'data', payload: [...] }    // Leader sharing data with followers
```

### Why Leader Election?

Without leader election, each browser tab would open its own WebSocket connection:
- 5 tabs = 5 WebSocket connections = 5x server resources
- With leader election: 5 tabs = 1 WebSocket connection

---

## Backend Implementation

### 1. Todo Model with Caching

**File:** `app/models/todo.rb`

```ruby
class Todo < ApplicationRecord
  CACHE_KEY = "todos:broadcast_list"

  validates :title, presence: true
  scope :ordered, -> { order(created_at: :desc) }

  # Invalidate cache after any change (create, update, destroy)
  after_commit :invalidate_cache

  # Returns cached JSON representation of all todos
  def self.broadcast_list
    Rails.cache.fetch(CACHE_KEY, expires_in: 1.hour) do
      ordered.as_json(only: %i[id title completed created_at])
    end
  end

  def self.invalidate_broadcast_cache
    Rails.cache.delete(CACHE_KEY)
  end

  private

  def invalidate_cache
    self.class.invalidate_broadcast_cache
  end
end
```

**Key Points:**
- `broadcast_list` caches the serialized todo list for 1 hour
- `after_commit` ensures cache is invalidated only after successful DB transaction
- Uses `as_json(only: [...])` to serialize only needed fields

### 2. Background Job for Broadcasting

**File:** `app/jobs/broadcast_todos_job.rb`

```ruby
class BroadcastTodosJob < ApplicationJob
  queue_as :default

  # Discard failed jobs - stale data is acceptable since newer jobs follow
  discard_on StandardError

  def perform
    todos = Todo.broadcast_list  # Fetches from cache or DB
    ActionCable.server.broadcast("todos", { todos: todos })
    Rails.logger.info "[BroadcastTodosJob] Broadcasted #{todos.size} todos"
  end
end
```

**Key Points:**
- Runs asynchronously via Solid Queue (doesn't block HTTP response)
- `discard_on StandardError` prevents retries (next update will correct any issues)
- Re-fetches data to ensure cache is populated

### 3. ActionCable Channel

**File:** `app/channels/todos_channel.rb`

```ruby
class TodosChannel < ApplicationCable::Channel
  def subscribed
    stream_from "todos"
    # Send cached todos immediately for instant UI hydration
    transmit(todos: Todo.broadcast_list)
  end
end
```

**Key Points:**
- Streams from the `"todos"` broadcast channel
- Immediately transmits current data on subscribe (no waiting for first update)

### 4. Controller with Broadcast Triggering

**File:** `app/controllers/todos_controller.rb`

```ruby
class TodosController < ApplicationController
  layout "inertia"

  def index
    render inertia: "Todos/Index", props: { todos: Todo.broadcast_list }
  end

  def create
    todo = Todo.new(todo_params)
    if todo.save
      broadcast_update_async  # Queue background job
      render json: todo.as_json(only: %i[id title completed created_at]), status: :created
    else
      render json: { errors: todo.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def update
    todo = Todo.find(params[:id])
    if todo.update(todo_params)
      broadcast_update_async
      render json: todo.as_json(only: %i[id title completed created_at])
    else
      render json: { errors: todo.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def destroy
    Todo.find(params[:id]).destroy
    broadcast_update_async
    head :no_content
  end

  private

  def todo_params
    params.require(:todo).permit(:title, :completed)
  end

  def broadcast_update_async
    BroadcastTodosJob.perform_later
  end
end
```

**Key Points:**
- `index` renders Inertia page with cached todos (server-side rendering)
- CRUD actions call `broadcast_update_async` to queue the broadcast job
- HTTP response returns immediately; WebSocket update follows asynchronously

---

## Frontend Implementation

### 1. Jotai State Atoms

**File:** `app/javascript/atoms/todos.js`

```javascript
import { atom } from 'jotai'

// Core state
export const todosAtom = atom([])
export const isLeaderAtom = atom(false)

// Derived state (computed automatically)
export const todoCountAtom = atom((get) => get(todosAtom).length)
export const completedCountAtom = atom((get) => 
  get(todosAtom).filter(todo => todo.completed).length
)
```

**File:** `app/javascript/atoms/logs.js`

```javascript
import { atom } from 'jotai'

const MAX_LOGS = 50

export const logsAtom = atom([])

// Write-only atom for adding log entries
export const addLogAtom = atom(
  null,
  (get, set, { category, message }) => {
    const entry = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit', 
        fractionalSecondDigits: 3 
      }),
      category,
      message,
    }
    const currentLogs = get(logsAtom)
    set(logsAtom, [entry, ...currentLogs].slice(0, MAX_LOGS))
  }
)

export const clearLogsAtom = atom(null, (_get, set) => set(logsAtom, []))
```

### 2. Leader Election Hook

**File:** `app/javascript/hooks/useLeaderElection.js`

```javascript
import { useEffect, useRef, useCallback } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { isLeaderAtom } from '../atoms/todos'
import { addLogAtom } from '../atoms/logs'

const TAB_ID = crypto.randomUUID().slice(0, 8)
const HEARTBEAT_MS = 2000
const TIMEOUT_MS = 5000

export function useLeaderElection(channelName, { onMessage } = {}) {
  const [isLeader, setIsLeader] = useAtom(isLeaderAtom)
  const addLog = useSetAtom(addLogAtom)
  const channelRef = useRef(null)
  const heartbeatRef = useRef(null)
  const timeoutRef = useRef(null)
  const isLeaderRef = useRef(false)

  useEffect(() => { isLeaderRef.current = isLeader }, [isLeader])

  const broadcast = useCallback((data) => {
    channelRef.current?.postMessage({ type: 'data', payload: data, from: TAB_ID })
  }, [])

  useEffect(() => {
    const channel = new BroadcastChannel(channelName)
    channelRef.current = channel

    const send = (type, payload = null) => 
      channel.postMessage({ type, payload, from: TAB_ID })

    const becomeLeader = () => {
      if (isLeaderRef.current) return
      isLeaderRef.current = true
      setIsLeader(true)
      clearTimeout(timeoutRef.current)
      heartbeatRef.current = setInterval(() => send('ping'), HEARTBEAT_MS)
      send('ping')
      addLog({ category: 'leader', message: 'Became leader' })
    }

    const becomeFollower = () => {
      if (!isLeaderRef.current) return
      isLeaderRef.current = false
      setIsLeader(false)
      clearInterval(heartbeatRef.current)
      addLog({ category: 'follower', message: 'Became follower' })
    }

    const resetTimeout = () => {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        if (!isLeaderRef.current) becomeLeader()
      }, TIMEOUT_MS)
    }

    channel.onmessage = ({ data: { type, payload, from } }) => {
      if (from === TAB_ID) return  // Ignore own messages
      
      if (type === 'ping') {
        // Another leader exists; lower ID wins
        if (isLeaderRef.current && from < TAB_ID) becomeFollower()
        resetTimeout()
      } else if (type === 'discover' && isLeaderRef.current) {
        send('ping')  // Respond to new tabs
      } else if (type === 'data' && !isLeaderRef.current && onMessage) {
        onMessage(payload)  // Follower receives data
      }
    }

    send('discover')  // Ask if leader exists
    setTimeout(() => {
      if (!isLeaderRef.current && !timeoutRef.current) becomeLeader()
    }, 500)

    return () => {
      clearInterval(heartbeatRef.current)
      clearTimeout(timeoutRef.current)
      channel.close()
    }
  }, [channelName, onMessage, setIsLeader, addLog])

  return { isLeader, broadcast }
}
```

### 3. Todo Sync Hook (Main Orchestration)

**File:** `app/javascript/hooks/useTodoSync.js`

```javascript
import { useEffect, useRef, useCallback } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import consumer from '../channels/consumer'
import { useLeaderElection } from './useLeaderElection'
import { todosAtom, isLeaderAtom } from '../atoms/todos'
import { addLogAtom } from '../atoms/logs'

export function useTodoSync(initialTodos) {
  const [todos, setTodos] = useAtom(todosAtom)
  const [isLeader] = useAtom(isLeaderAtom)
  const addLog = useSetAtom(addLogAtom)
  const subscriptionRef = useRef(null)
  const initializedRef = useRef(false)

  // Initialize from server-rendered props (once)
  useEffect(() => {
    if (!initializedRef.current && initialTodos?.length > 0) {
      setTodos(initialTodos)
      initializedRef.current = true
    }
  }, [initialTodos, setTodos])

  // Leader election with data relay callback
  const { broadcast } = useLeaderElection('todos-sync', {
    onMessage: useCallback((data) => setTodos(data), [setTodos])
  })

  // Leader-only WebSocket subscription
  useEffect(() => {
    if (!isLeader) {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = null
      return
    }

    subscriptionRef.current = consumer.subscriptions.create("TodosChannel", {
      connected() {
        addLog({ category: 'cable', message: 'Connected to TodosChannel' })
      },
      disconnected() {
        addLog({ category: 'cable', message: 'Disconnected from TodosChannel' })
      },
      received(data) {
        if (data.todos) {
          addLog({ category: 'cable', message: `Received ${data.todos.length} todos` })
          setTodos(data.todos)
          broadcast(data.todos)  // Relay to followers
          addLog({ category: 'broadcast', message: 'Relayed todos to followers' })
        }
      }
    })

    return () => subscriptionRef.current?.unsubscribe()
  }, [isLeader, broadcast, setTodos, addLog])

  return { todos, isLeader }
}
```

### 4. Page Component Usage

**File:** `app/javascript/pages/Todos/Index.jsx`

```javascript
import { useState, useRef } from 'react'
import { useAtom } from 'jotai'
import { useTodoSync } from '../../hooks/useTodoSync'
import { todoCountAtom, completedCountAtom } from '../../atoms/todos'

export default function Index({ todos: initialTodos }) {
  // Initialize sync with server-rendered data
  const { todos } = useTodoSync(initialTodos)
  const [todoCount] = useAtom(todoCountAtom)
  const [completedCount] = useAtom(completedCountAtom)
  
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content

  const handleCreate = async (title) => {
    await fetch('/todos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ todo: { title } }),
    })
    // UI updates via WebSocket, not from this response
  }

  const handleToggle = async (todo) => {
    await fetch(`/todos/${todo.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ todo: { completed: !todo.completed } }),
    })
  }

  const handleDelete = async (id) => {
    await fetch(`/todos/${id}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrfToken },
    })
  }

  return (
    <div>
      <h1>Todos ({todoCount} total, {completedCount} done)</h1>
      {/* Form and list rendering... */}
    </div>
  )
}
```

---

## Data Flow Examples

### Example 1: Initial Page Load

```
1. Browser requests GET /todos
2. Rails: TodosController#index
   └─ Calls Todo.broadcast_list (cache miss → queries DB → caches result)
   └─ Renders Inertia page with props: { todos: [...] }
3. Browser receives HTML with embedded JSON props
4. React hydrates, useTodoSync initializes Jotai state
5. useLeaderElection sends 'discover' via BroadcastChannel
6. No response in 500ms → tab becomes LEADER
7. Leader subscribes to TodosChannel via ActionCable
8. TodosChannel#subscribed transmits cached todos immediately
```

### Example 2: Creating a Todo

```
Timeline:
─────────────────────────────────────────────────────────────────────
  0ms   User clicks "Add"
        └─ fetch POST /todos { title: "Buy milk" }
        
 10ms   Rails receives request
        └─ Todo.create! triggers after_commit
        └─ Cache invalidated (Rails.cache.delete)
        └─ BroadcastTodosJob.perform_later enqueued
        └─ HTTP 201 response sent
        
 15ms   Browser receives 201 (UI unchanged, waiting for WebSocket)

100ms   Solid Queue picks up job
        └─ Todo.broadcast_list (cache miss → queries DB → caches)
        └─ ActionCable.server.broadcast("todos", { todos: [...] })

105ms   Leader tab receives WebSocket message
        └─ Jotai state updated
        └─ BroadcastChannel.postMessage({ type: 'data', payload: [...] })

106ms   Follower tabs receive BroadcastChannel message
        └─ Jotai state updated

110ms   ALL TABS show updated UI simultaneously
─────────────────────────────────────────────────────────────────────
```

### Example 3: Leader Tab Closes

```
Timeline:
─────────────────────────────────────────────────────────────────────
  0ms   User closes leader tab

2000ms  Followers notice missing heartbeat (ping)
        └─ Timeout started (5 seconds)

5000ms  Timeout expires
        └─ Follower with lowest TAB_ID becomes new leader
        └─ New leader subscribes to ActionCable
        └─ TodosChannel sends current cached todos
        └─ New leader starts sending heartbeats
─────────────────────────────────────────────────────────────────────
```

---

## Solid Queue & Solid Cache

This application uses Rails 8's "Solid" adapters - SQLite-backed implementations of job queuing and caching that eliminate the need for Redis or Memcached in production.

### Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      SOLID TRIFECTA                                  │
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  Solid Queue    │  │  Solid Cache    │  │   Solid Cable       │  │
│  │  (Background    │  │  (Rails.cache)  │  │   (ActionCable)     │  │
│  │   Jobs)         │  │                 │  │                     │  │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘  │
│           │                    │                      │             │
│           ▼                    ▼                      ▼             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    SQLite Databases                          │    │
│  │  storage/production_queue.sqlite3                            │    │
│  │  storage/production_cache.sqlite3                            │    │
│  │  storage/production_cable.sqlite3                            │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Solid Queue

[Solid Queue](https://github.com/rails/solid_queue) is a database-backed Active Job backend. It replaces Redis-based solutions like Sidekiq or Resque.

#### How It Works in This App

1. **Controller enqueues job:**
   ```ruby
   # In TodosController after create/update/destroy
   BroadcastTodosJob.perform_later
   ```

2. **Job is written to SQLite:**
   ```sql
   INSERT INTO solid_queue_jobs (class_name, arguments, queue_name, ...)
   VALUES ('BroadcastTodosJob', '[]', 'default', ...)
   ```

3. **Worker polls and executes:**
   - Worker process polls `solid_queue_jobs` table every 0.1 seconds
   - Claims job, executes `BroadcastTodosJob#perform`
   - Deletes job record on success

#### Configuration

**`config/queue.yml`**
```yaml
default: &default
  dispatchers:
    - polling_interval: 1      # How often to check for scheduled jobs
      batch_size: 500          # Max jobs to dispatch per poll
  workers:
    - queues: "*"              # Process all queues
      threads: 3               # Concurrent job threads
      polling_interval: 0.1    # Poll every 100ms for real-time feel
```

#### Key Tables

| Table | Purpose |
|-------|---------|
| `solid_queue_jobs` | Pending jobs waiting to be processed |
| `solid_queue_claimed_executions` | Jobs currently being processed |
| `solid_queue_failed_executions` | Jobs that raised exceptions |
| `solid_queue_scheduled_executions` | Jobs scheduled for future execution |

#### Why Solid Queue for Real-Time?

- **Low latency:** 0.1s polling means broadcasts happen within ~100ms of the HTTP response
- **No Redis dependency:** Simpler deployment, fewer moving parts
- **Transactional safety:** Jobs are enqueued in the same transaction as data changes (if needed)

### Solid Cache

[Solid Cache](https://github.com/rails/solid_cache) is a database-backed Rails cache store. It replaces Redis or Memcached for caching.

#### How It Works in This App

1. **Cache read (hit):**
   ```ruby
   Todo.broadcast_list
   # → Rails.cache.fetch("todos:broadcast_list") 
   # → SELECT value FROM solid_cache_entries WHERE key = 'todos:broadcast_list'
   # → Returns cached JSON array
   ```

2. **Cache read (miss):**
   ```ruby
   Todo.broadcast_list
   # → Cache miss
   # → Queries: SELECT * FROM todos ORDER BY created_at DESC
   # → Serializes to JSON
   # → INSERT INTO solid_cache_entries (key, value, ...) VALUES (...)
   # → Returns fresh data
   ```

3. **Cache invalidation:**
   ```ruby
   # In Todo model after_commit callback
   Rails.cache.delete("todos:broadcast_list")
   # → DELETE FROM solid_cache_entries WHERE key = 'todos:broadcast_list'
   ```

#### Configuration

**`config/cache.yml`**
```yaml
default: &default
  store_options:
    max_size: <%= 256.megabytes %>  # Auto-evicts old entries when exceeded
    namespace: <%= Rails.env %>      # Prevents dev/prod key collisions
```

**`config/environments/production.rb`**
```ruby
config.cache_store = :solid_cache_store
```

#### Key Tables

| Table | Purpose |
|-------|---------|
| `solid_cache_entries` | Cached key-value pairs with expiration |

#### Why Solid Cache for Real-Time?

- **Reduces DB load:** `Todo.broadcast_list` only queries the DB once per change, not once per WebSocket subscriber
- **Consistent reads:** All broadcast jobs read the same cached data
- **Automatic expiration:** 1-hour TTL ensures stale data eventually refreshes

### Solid Cable

[Solid Cable](https://github.com/rails/solid_cable) is a database-backed ActionCable adapter. It replaces Redis pub/sub for WebSocket message broadcasting.

#### How It Works

1. **Server broadcasts:**
   ```ruby
   ActionCable.server.broadcast("todos", { todos: [...] })
   # → INSERT INTO solid_cable_messages (channel, payload, ...) VALUES ('todos', '{"todos":[...]}', ...)
   ```

2. **Subscribers poll:**
   - Each Puma process polls `solid_cable_messages` every 0.1 seconds
   - New messages are pushed to connected WebSocket clients
   - Old messages are cleaned up after retention period

#### Configuration

**`config/cable.yml`**
```yaml
production:
  adapter: solid_cable
  connects_to:
    database:
      writing: cable
  polling_interval: 0.1.seconds  # Check for new messages every 100ms
  message_retention: 1.day       # Clean up old messages after 1 day
```

### Development vs Production

In development, all three use in-process adapters for simplicity:

| Component | Development | Production |
|-----------|-------------|------------|
| **Jobs** | `async` (in-process threads) | `solid_queue` (SQLite) |
| **Cache** | `memory_store` (in-process hash) | `solid_cache_store` (SQLite) |
| **Cable** | `async` (in-process pub/sub) | `solid_cable` (SQLite) |

This means development requires no external services, while production uses durable SQLite storage.

### Database Files

Production uses separate SQLite databases for isolation:

```
storage/
├── production.sqlite3        # Primary app data (todos, users, etc.)
├── production_cache.sqlite3  # Solid Cache entries
├── production_queue.sqlite3  # Solid Queue jobs
└── production_cable.sqlite3  # Solid Cable messages
```

This separation provides:
- **Independent scaling:** Cache can grow without affecting job queue
- **Easier maintenance:** Can clear cache without touching jobs
- **Better performance:** Reduces write contention

---

## Thruster (Production HTTP Proxy)

In production, this application uses [Thruster](https://github.com/basecamp/thruster) as a lightweight HTTP proxy that sits in front of Puma. Thruster is a Rust-based proxy from Basecamp that provides several performance optimizations without requiring a separate Nginx or Apache server.

### What Thruster Does

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PRODUCTION STACK                              │
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐   │
│  │   Internet   │───▶│   Thruster   │───▶│     Puma Server      │   │
│  │   (Port 80)  │    │   (Proxy)    │    │   (Rails App)        │   │
│  └──────────────┘    └──────────────┘    └──────────────────────┘   │
│                            │                                         │
│                            ├─ HTTP/2 support                         │
│                            ├─ Gzip/Brotli compression                │
│                            ├─ Asset caching (Cache-Control headers)  │
│                            ├─ X-Sendfile acceleration                │
│                            └─ Automatic HTTPS (via Let's Encrypt)    │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Features

| Feature | Description |
|---------|-------------|
| **HTTP/2** | Multiplexed connections for faster asset loading |
| **Compression** | Automatic gzip/Brotli compression for text-based responses |
| **Asset Caching** | Adds appropriate `Cache-Control` headers for static assets |
| **X-Sendfile** | Offloads file serving from Ruby to the proxy for efficiency |
| **Zero Config** | Works out of the box with Rails conventions |

### How It's Used

**Development:** Thruster is not used. Puma runs directly via `bin/rails server`.

**Production (Docker):** The Dockerfile starts the app via Thruster:

```dockerfile
# Dockerfile (line 77)
CMD ["./bin/thrust", "./bin/rails", "server"]
```

The `bin/thrust` wrapper loads the Thruster gem and proxies requests to Puma:

```ruby
# bin/thrust
#!/usr/bin/env ruby
require "rubygems"
require "bundler/setup"
load Gem.bin_path("thruster", "thrust")
```

### Why Thruster Matters for Real-Time Updates

While Thruster doesn't directly handle WebSocket connections (those pass through to Puma), it improves overall application performance by:

1. **Reducing Puma's workload** - Static assets and compressed responses are handled by Thruster, leaving Puma free to handle ActionCable WebSocket connections
2. **Faster initial page loads** - HTTP/2 and compression mean the React app loads faster, reducing time to WebSocket connection
3. **Better connection efficiency** - HTTP/2 multiplexing reduces connection overhead

---

## Configuration

### Development vs Production

| Component | Development | Production |
|-----------|-------------|------------|
| **ActionCable** | `async` adapter (in-process) | `solid_cable` (SQLite-backed) |
| **Cache** | `memory_store` (in-process) | `solid_cache_store` (SQLite-backed) |
| **Jobs** | `async` adapter (in-process) | `solid_queue` (SQLite-backed) |

### Configuration Files

**`config/cable.yml`** - ActionCable adapter
```yaml
development:
  adapter: async

production:
  adapter: solid_cable
  connects_to:
    database:
      writing: cable
  polling_interval: 0.1.seconds
  message_retention: 1.day
```

**`config/queue.yml`** - Solid Queue settings
```yaml
default: &default
  dispatchers:
    - polling_interval: 1
      batch_size: 500
  workers:
    - queues: "*"
      threads: 3
      polling_interval: 0.1  # Fast pickup for real-time
```

**`config/cache.yml`** - Solid Cache settings
```yaml
default: &default
  store_options:
    max_size: <%= 256.megabytes %>
    namespace: <%= Rails.env %>
```

**`config/database.yml`** - Production databases
```yaml
production:
  primary:
    database: storage/production.sqlite3
  cache:
    database: storage/production_cache.sqlite3
  queue:
    database: storage/production_queue.sqlite3
  cable:
    database: storage/production_cable.sqlite3
```

---

## File Reference

### Backend Files

| File | Purpose |
|------|---------|
| `app/models/todo.rb` | Todo model with caching (`broadcast_list`, `after_commit`) |
| `app/controllers/todos_controller.rb` | CRUD operations, triggers async broadcasts |
| `app/channels/todos_channel.rb` | ActionCable channel for WebSocket subscriptions |
| `app/jobs/broadcast_todos_job.rb` | Background job that broadcasts to all subscribers |
| `config/cable.yml` | ActionCable adapter configuration |
| `config/queue.yml` | Solid Queue worker configuration |
| `config/cache.yml` | Solid Cache size/namespace configuration |
| `config/database.yml` | Database connections (primary, cache, queue, cable) |
| `bin/thrust` | Thruster proxy wrapper for production deployment |
| `Dockerfile` | Production container config using Thruster |

### Frontend Files

| File | Purpose |
|------|---------|
| `app/javascript/atoms/todos.js` | Jotai atoms: `todosAtom`, `isLeaderAtom`, derived counts |
| `app/javascript/atoms/logs.js` | Event logging atoms for debugging |
| `app/javascript/hooks/useTodoSync.js` | Main orchestration hook combining ActionCable + leader election |
| `app/javascript/hooks/useLeaderElection.js` | Tab leader election via BroadcastChannel |
| `app/javascript/channels/consumer.js` | ActionCable consumer singleton |
| `app/javascript/pages/Todos/Index.jsx` | Main todo page component |
| `app/javascript/components/LeaderBadge.jsx` | Visual leader/follower indicator |
| `app/javascript/components/EventLog.jsx` | Debug panel showing real-time events |

### Frontend State Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        JOTAI ATOMS                          │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │  todosAtom   │   │ isLeaderAtom │   │    logsAtom    │  │
│  │    [...]     │   │    boolean   │   │     [...]      │  │
│  └──────┬───────┘   └──────────────┘   └────────────────┘  │
│         │                                                   │
│  ┌──────┴───────┐   ┌──────────────────┐                   │
│  │ todoCountAtom│   │completedCountAtom│  (derived)        │
│  └──────────────┘   └──────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
         ▲                     ▲
         │                     │
   useTodoSync           useLeaderElection
         │                     │
         └──────────┬──────────┘
                    │
              Index.jsx (page)
```

---

## Quick Start

### Using the Sync Hook

```javascript
import { useTodoSync } from '../hooks/useTodoSync'

export default function MyPage({ todos: initialTodos }) {
  const { todos, isLeader } = useTodoSync(initialTodos)
  
  // todos: reactive array, auto-updates from WebSocket
  // isLeader: true if this tab maintains the WebSocket connection
  
  return (
    <ul>
      {todos.map(todo => <li key={todo.id}>{todo.title}</li>)}
    </ul>
  )
}
```

### Triggering a Broadcast (Backend)

```ruby
# In any controller or service
BroadcastTodosJob.perform_later
```

### Accessing Derived State

```javascript
import { useAtom } from 'jotai'
import { todoCountAtom, completedCountAtom } from '../atoms/todos'

function Stats() {
  const [total] = useAtom(todoCountAtom)
  const [completed] = useAtom(completedCountAtom)
  
  return <p>{completed} of {total} completed</p>
}
```
