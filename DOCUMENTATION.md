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
│  │              │    │ (async jobs) │    │ (Inertia redirects)  │   │
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
| **Inertia.js** | Handles routing, mutations (`router.post/patch/delete`), and server props (`usePage()`) |
| **Leader Tab** | Maintains WebSocket connection, receives server updates, relays to followers |
| **Follower Tabs** | Receive updates via BroadcastChannel (no WebSocket overhead) |
| **TodosChannel** | ActionCable channel that broadcasts todo updates |
| **BroadcastTodosJob** | Background job that fetches and broadcasts data |
| **Rails Cache** | Caches `Todo.broadcast_list` to avoid repeated DB queries |
| **Solid Queue** | SQLite-backed job queue for async processing |

### State Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      STATE MANAGEMENT                                │
│                                                                      │
│  ┌─────────────────────────────┐  ┌──────────────────────────────┐  │
│  │     INERTIA (Server Data)   │  │    JOTAI (Client-Only)       │  │
│  │                             │  │                              │  │
│  │  usePage().props.todos      │  │  isLeaderAtom                │  │
│  │  router.post/patch/delete   │  │  eventLogAtom                │  │
│  │  router.replace()           │  │                              │  │
│  └─────────────────────────────┘  └──────────────────────────────┘  │
│                │                               │                     │
│                └───────────────┬───────────────┘                     │
│                                │                                     │
│                        useTodoActions()                              │
│                  (combines both for unified API)                     │
└─────────────────────────────────────────────────────────────────────┘
```

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

### Inertia.js Integration

Inertia.js serves as the primary data layer for server communication:

1. **Initial Data**: Server renders page with `props: { todos: [...] }`
2. **Reading Data**: `usePage().props.todos` accesses current todos
3. **Mutations**: `router.post/patch/delete` sends requests, handles CSRF automatically
4. **Redirects**: Controller redirects back, Inertia fetches fresh props
5. **Real-time Updates**: ActionCable updates call `router.replace()` to update props without navigation

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

### 4. Controller with Inertia Redirects

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
      broadcast_update_async
      redirect_to todos_path
    else
      redirect_to todos_path, inertia: { errors: todo.errors.full_messages }
    end
  end

  def update
    todo = Todo.find(params[:id])
    if todo.update(todo_params)
      broadcast_update_async
      redirect_to todos_path
    else
      redirect_to todos_path, inertia: { errors: todo.errors.full_messages }
    end
  end

  def destroy
    Todo.find(params[:id]).destroy
    broadcast_update_async
    redirect_to todos_path
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
- CRUD actions redirect back to `todos_path` (standard Inertia pattern)
- Inertia follows redirect and fetches fresh props automatically
- `broadcast_update_async` queues job for real-time sync to other tabs/users

---

## Frontend Implementation

### 1. Jotai State Atoms (Client-Only)

**File:** `app/javascript/atoms/todos.ts`

```typescript
import { atom } from 'jotai'

// Leader election state (client-side tab coordination only)
export const isLeaderAtom = atom<boolean>(false)
```

**Note:** Todos are managed by Inertia, not Jotai. Only client-side concerns (leader election, event logging) use Jotai.

### 2. Event Log Hook

**File:** `app/javascript/hooks/useEventLog.ts`

```typescript
import { useCallback } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { atom } from 'jotai'
import type { LogEntry, LogCategory } from '../types'

const MAX_LOGS = 50

// Core logs atom
export const logsAtom = atom<LogEntry[]>([])

// Derived atom for log count
export const logCountAtom = atom((get) => get(logsAtom).length)

/**
 * Hook for managing event logs.
 * Returns utilities for adding, clearing, and reading logs.
 */
export function useEventLog() {
  const [logs, setLogs] = useAtom(logsAtom)

  const addLog = useCallback((category: LogCategory, message: string) => {
    const entry: LogEntry = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      } as Intl.DateTimeFormatOptions),
      category,
      message,
    }
    setLogs((currentLogs) => [entry, ...currentLogs].slice(0, MAX_LOGS))
  }, [setLogs])

  const clearLogs = useCallback(() => {
    setLogs([])
  }, [setLogs])

  return { logs, addLog, clearLogs }
}

/**
 * Lightweight hook that only provides the addLog function.
 * Use this in hooks/components that only need to write logs.
 */
export function useLogWriter() {
  const setLogs = useSetAtom(logsAtom)

  const addLog = useCallback((category: LogCategory, message: string) => {
    const entry: LogEntry = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      } as Intl.DateTimeFormatOptions),
      category,
      message,
    }
    setLogs((currentLogs) => [entry, ...currentLogs].slice(0, MAX_LOGS))
  }, [setLogs])

  return addLog
}
```

### 3. Leader Election Hook

**File:** `app/javascript/hooks/useLeaderElection.ts`

```typescript
import { useEffect, useRef, useCallback } from 'react'
import { useAtom } from 'jotai'
import { isLeaderAtom } from '../atoms/todos'
import { useLogWriter } from './useEventLog'
import type { Todo } from '../types'

const TAB_ID = crypto.randomUUID().slice(0, 8)
const HEARTBEAT_MS = 2000
const TIMEOUT_MS = 5000

type MessageType = 'ping' | 'discover' | 'data'

interface BroadcastMessage {
  type: MessageType
  payload: Todo[] | null
  from: string
}

interface UseLeaderElectionOptions {
  onMessage?: (data: Todo[]) => void
}

/**
 * Leader election across browser tabs using BroadcastChannel.
 * Only one tab becomes leader; others receive data via broadcast.
 */
export function useLeaderElection(
  channelName: string,
  { onMessage }: UseLeaderElectionOptions = {}
) {
  const [isLeader, setIsLeader] = useAtom(isLeaderAtom)
  const addLog = useLogWriter()
  const channelRef = useRef<BroadcastChannel | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLeaderRef = useRef(false)

  useEffect(() => {
    isLeaderRef.current = isLeader
  }, [isLeader])

  const broadcast = useCallback((data: Todo[]) => {
    channelRef.current?.postMessage({ type: 'data', payload: data, from: TAB_ID })
  }, [])

  useEffect(() => {
    const channel = new BroadcastChannel(channelName)
    channelRef.current = channel

    const send = (type: MessageType, payload: Todo[] | null = null) =>
      channel.postMessage({ type, payload, from: TAB_ID })

    const becomeLeader = () => {
      if (isLeaderRef.current) return
      isLeaderRef.current = true
      setIsLeader(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      heartbeatRef.current = setInterval(() => send('ping'), HEARTBEAT_MS)
      send('ping')
      addLog('leader', 'Became leader')
    }

    const becomeFollower = () => {
      if (!isLeaderRef.current) return
      isLeaderRef.current = false
      setIsLeader(false)
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
      addLog('follower', 'Became follower (another tab has lower ID)')
    }

    const resetTimeout = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        if (!isLeaderRef.current) becomeLeader()
      }, TIMEOUT_MS)
    }

    channel.onmessage = ({ data }: MessageEvent<BroadcastMessage>) => {
      const { type, payload, from } = data
      if (from === TAB_ID) return
      if (type === 'ping') {
        if (isLeaderRef.current && from < TAB_ID) becomeFollower()
        resetTimeout()
      } else if (type === 'discover' && isLeaderRef.current) {
        send('ping')
        addLog('broadcast', `Responded to discover from ${from}`)
      } else if (type === 'data' && !isLeaderRef.current && onMessage && payload) {
        addLog('broadcast', 'Received data from leader')
        onMessage(payload)
      }
    }

    addLog('broadcast', `Joining channel "${channelName}"`)
    send('discover')
    setTimeout(() => {
      if (!isLeaderRef.current && !timeoutRef.current) becomeLeader()
    }, 500)

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      channel.close()
    }
  }, [channelName, onMessage, setIsLeader, addLog])

  return { isLeader, broadcast }
}
```

### 4. Unified Todo Actions Hook (Inertia + ActionCable)

**File:** `app/javascript/hooks/useTodoActions.ts`

This hook combines Inertia for server data/mutations with ActionCable for real-time sync:

```typescript
import { useEffect, useRef, useCallback, useMemo, useEffectEvent } from "react";
import { useAtom } from "jotai";
import { router, usePage } from "@inertiajs/react";
import consumer from "../channels/consumer";
import { useLeaderElection } from "./useLeaderElection";
import { isLeaderAtom } from "../atoms/todos";
import { useLogWriter } from "./useEventLog";
import type { Todo, PageProps } from "../types";
import type { Subscription } from "@rails/actioncable";

const updateTodos = (todos: Todo[]) => {
  router.replaceProp("todos", todos);
};

interface CableData {
  todos?: Todo[];
}

export function useTodoActions() {
  const { todos } = usePage<PageProps>().props;
  const [isLeader] = useAtom(isLeaderAtom);
  const addLog = useLogWriter();
  const subscriptionRef = useRef<Subscription | null>(null);

  // Derived counts
  const todoCount = useMemo(() => todos?.length ?? 0, [todos]);
  const completedCount = useMemo(
    () => todos?.filter((todo) => todo.completed).length ?? 0,
    [todos],
  );

  const { broadcast } = useLeaderElection("todos-sync", {
    onMessage: useCallback((data: Todo[]) => updateTodos(data), []),
  });

  // Effect Events for ActionCable callbacks (non-reactive)
  const onConnected = useEffectEvent(() => {
    addLog("cable", "Connected to TodosChannel");
  });

  const onDisconnected = useEffectEvent(() => {
    addLog("cable", "Disconnected from TodosChannel");
  });

  const onReceived = useEffectEvent((data: CableData) => {
    if (data.todos) {
      addLog("cable", `Received ${data.todos.length} todos`);
      updateTodos(data.todos);
      broadcast(data.todos);
      addLog("broadcast", "Relayed todos to followers");
    }
  });

  // ActionCable subscription (leader only)
  useEffect(() => {
    if (!isLeader) {
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
      return;
    }

    subscriptionRef.current = consumer.subscriptions.create("TodosChannel", {
      connected: onConnected,
      disconnected: onDisconnected,
      received: onReceived,
    });

    return () => {
      subscriptionRef.current?.unsubscribe();
    };
  }, [isLeader]);

  const toggleTodo = useCallback((todo: Todo) => {
    const previousCompleted = todo.completed;

    // Optimistic update using Inertia's SPA-style prop replacement
    router.replaceProp("todos", (currentTodos: Todo[]) =>
      currentTodos.map((t) =>
        t.id === todo.id ? { ...t, completed: !previousCompleted } : t
      )
    );

    router.patch(
      `/todos/${todo.id}`,
      { todo: { completed: !previousCompleted } },
      {
        preserveScroll: true,
        onError: () => {
          // Revert on error
          router.replaceProp("todos", (currentTodos: Todo[]) =>
            currentTodos.map((t) =>
              t.id === todo.id ? { ...t, completed: previousCompleted } : t
            )
          );
        },
      }
    );
  }, []);

  const deleteTodo = useCallback((todoId: number) => {
    // Capture the todo for potential restoration
    const todoToDelete = todos?.find((t) => t.id === todoId);

    // Optimistic update using Inertia's SPA-style prop replacement
    router.replaceProp("todos", (currentTodos: Todo[]) =>
      currentTodos.filter((t) => t.id !== todoId)
    );

    router.delete(`/todos/${todoId}`, {
      preserveScroll: true,
      onError: () => {
        // Revert on error by re-adding the todo
        if (todoToDelete) {
          router.replaceProp("todos", (currentTodos: Todo[]) => [
            ...currentTodos,
            todoToDelete,
          ]);
        }
      },
    });
  }, [todos]);

  return {
    todos: todos ?? [],
    todoCount,
    completedCount,
    isLeader,
    toggleTodo,
    deleteTodo,
  };
}
```

**Key Points:**
- `usePage<PageProps>().props.todos` - Reads todos from Inertia (server-rendered) with TypeScript generics
- `router.patch/delete` - Sends mutations via Inertia (CSRF automatic)
- `router.replaceProp()` - Updates Inertia props when ActionCable receives data (simpler API than `router.replace()`)
- Optimistic updates with automatic rollback on error
- Counts computed with `useMemo` instead of separate Jotai atoms
- Note: `createTodo` is not exposed - the page uses Inertia's `<Form>` component directly

### 5. Page Component Usage

**File:** `app/javascript/pages/Todos/Index.tsx`

```typescript
import { Form } from "@inertiajs/react";
import { useTodoActions } from "../../hooks/useTodoActions";
import { EventLog } from "../../components/EventLog";
import { LeaderBadge } from "../../components/LeaderBadge";
import "./Index.css";

export default function Index() {
  const { todos, todoCount, completedCount, toggleTodo, deleteTodo } = useTodoActions();

  return (
    <div className="todos-container">
      <LeaderBadge />

      <h1 className="todos-title">Todos</h1>

      <div className="todos-stats">
        <div className="todos-stat">
          <span className="todos-stat__value">{todoCount}</span>
          <span className="todos-stat__label">Total</span>
        </div>
        <div className="todos-stat">
          <span className="todos-stat__value">{completedCount}</span>
          <span className="todos-stat__label">Done</span>
        </div>
        <div className="todos-stat">
          <span className="todos-stat__value">
            {todoCount - completedCount}
          </span>
          <span className="todos-stat__label">Remaining</span>
        </div>
      </div>

      <Form
        action="/todos"
        method="post"
        className="todos-form"
        resetOnSuccess
        options={{ preserveScroll: true }}
      >
        <input
          type="text"
          name="todo[title]"
          placeholder="What needs to be done?"
          className="todos-input"
        />
        <button type="submit" className="todos-add-button">
          Add
        </button>
      </Form>

      <ul className="todos-list">
        {todos.map((todo) => (
          <li key={todo.id} className="todos-item">
            <label className="todos-label">
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleTodo(todo)}
                className="todos-checkbox"
              />
              <span
                className={`todos-text ${todo.completed ? "todos-text--completed" : ""}`}
              >
                {todo.title}
              </span>
            </label>
            <button
              onClick={() => deleteTodo(todo.id)}
              className="todos-delete-button"
              aria-label="Delete todo"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {todos.length === 0 && (
        <p className="todos-empty">No todos yet. Add one above!</p>
      )}

      <EventLog />
    </div>
  );
}
```

**Key Points:**
- Uses Inertia's `<Form>` component for creating todos (handles CSRF, resets on success)
- `useTodoActions()` reads from `usePage().props` - no initial props needed
- BEM-style CSS classes with co-located stylesheet (`Index.css`)
- Inertia's NProgress handles loading indicators automatically

### 6. Inertia App Setup

**File:** `app/javascript/entrypoints/inertia.tsx`

```typescript
import { createInertiaApp } from '@inertiajs/react'
import { createRoot } from 'react-dom/client'
import { ComponentType } from 'react'

interface PageModule {
  default: ComponentType
}

createInertiaApp({
  progress: {
    delay: 250,        // Show after 250ms (avoids flicker on fast requests)
    color: '#4f46e5',  // Indigo color
    includeCSS: true,  // Include NProgress styles
    showSpinner: false,
  },
  resolve: (name) => {
    const pages = import.meta.glob<PageModule>('../pages/**/*.tsx', { eager: true })
    return pages[`../pages/${name}.tsx`]
  },
  setup({ el, App, props }) {
    createRoot(el!).render(<App {...props} />)
  },
})
```

### 7. Event Log Component

**File:** `app/javascript/components/EventLog.tsx`

```typescript
import { useState } from 'react'
import { useEventLog } from '../hooks/useEventLog'
import './EventLog.css'

export function EventLog() {
  const { logs, clearLogs } = useEventLog()
  const [isCollapsed, setIsCollapsed] = useState(false)

  if (isCollapsed) {
    return (
      <div className="event-log__collapsed">
        <button onClick={() => setIsCollapsed(false)} className="event-log__expand-btn">
          Show Logs ({logs.length})
        </button>
      </div>
    )
  }

  return (
    <div className="event-log">
      <div className="event-log__header">
        <span className="event-log__title">Event Log</span>
        <div className="event-log__buttons">
          <button onClick={() => clearLogs()} className="event-log__btn">Clear</button>
          <button onClick={() => setIsCollapsed(true)} className="event-log__btn">Hide</button>
        </div>
      </div>
      <div className="event-log__list">
        {logs.length === 0 ? (
          <div className="event-log__empty">No events yet...</div>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className="event-log__entry">
              <span className="event-log__time">{entry.time}</span>
              <span className={`event-log__category event-log__category--${entry.category}`}>
                [{entry.category}]
              </span>
              <span className="event-log__message">{entry.message}</span>
            </div>
          ))
        )}
      </div>
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
4. React hydrates, useTodoActions reads usePage().props.todos
5. useLeaderElection sends 'discover' via BroadcastChannel
6. No response in 500ms → tab becomes LEADER
7. Leader subscribes to TodosChannel via ActionCable
8. TodosChannel#subscribed transmits cached todos immediately
```

### Example 2: Creating a Todo (Inertia Flow)

```
Timeline:
─────────────────────────────────────────────────────────────────────
  0ms   User clicks "Add"
        └─ router.post('/todos', { todo: { title: "Buy milk" } })
        └─ Inertia shows NProgress bar (after 250ms delay)
        
 10ms   Rails receives request
        └─ Todo.create! triggers after_commit
        └─ Cache invalidated (Rails.cache.delete)
        └─ BroadcastTodosJob.perform_later enqueued
        └─ redirect_to todos_path
        
 15ms   Inertia follows redirect
        └─ GET /todos fetches fresh props
        └─ UI updates with new todo (current tab)

100ms   Solid Queue picks up job
        └─ Todo.broadcast_list (cache miss → queries DB → caches)
        └─ ActionCable.server.broadcast("todos", { todos: [...] })

105ms   Leader tab receives WebSocket message
        └─ router.replace() updates Inertia props
        └─ BroadcastChannel.postMessage({ type: 'data', payload: [...] })

106ms   Follower tabs receive BroadcastChannel message
        └─ router.replace() updates their Inertia props

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
| `app/controllers/todos_controller.rb` | CRUD with Inertia redirects, triggers async broadcasts |
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
| `app/javascript/atoms/todos.ts` | Jotai atom: `isLeaderAtom` (client-side only) |
| `app/javascript/hooks/useTodoActions.ts` | Todo state via Inertia, sync via ActionCable, CRUD via router |
| `app/javascript/hooks/useLeaderElection.ts` | Tab leader election via BroadcastChannel |
| `app/javascript/hooks/useEventLog.ts` | Event logging hooks: `useEventLog()`, `useLogWriter()` |
| `app/javascript/channels/consumer.ts` | ActionCable consumer singleton |
| `app/javascript/entrypoints/inertia.tsx` | Inertia app setup with NProgress config |
| `app/javascript/pages/Todos/Index.tsx` | Main todo page component |
| `app/javascript/components/LeaderBadge.tsx` | Visual leader/follower indicator |
| `app/javascript/components/EventLog.tsx` | Debug panel showing real-time events |
| `app/javascript/types/index.ts` | TypeScript interfaces (Todo, PageProps, LogEntry, LogCategory) |

### Frontend State Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         STATE SOURCES                                │
│                                                                      │
│  ┌─────────────────────────────┐  ┌──────────────────────────────┐  │
│  │        INERTIA              │  │          JOTAI               │  │
│  │   (Server Data)             │  │    (Client-Only State)       │  │
│  │                             │  │                              │  │
│  │  usePage().props.todos      │  │  isLeaderAtom                │  │
│  │                             │  │  logsAtom                    │  │
│  └─────────────┬───────────────┘  └──────────────┬───────────────┘  │
│                │                                  │                  │
│                └──────────────┬───────────────────┘                  │
│                               │                                      │
│                       useTodoActions()                               │
│                               │                                      │
│            ┌──────────────────┼──────────────────┐                   │
│            │                  │                  │                   │
│            ▼                  ▼                  ▼                   │
│     router.post()    useLeaderElection()   useLogWriter()           │
│     router.patch()        │                     │                   │
│     router.delete()       │                     │                   │
│     router.replace()      │                     │                   │
│            │              │                     │                   │
│            └──────────────┼─────────────────────┘                   │
│                           │                                          │
│                     Index.jsx (page)                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Using the Todo Actions Hook

```typescript
import { Form } from '@inertiajs/react'
import { useTodoActions } from '../hooks/useTodoActions'

export default function MyPage() {
  const { 
    todos,          // Array from usePage().props, auto-updates via Inertia
    todoCount,      // Derived count
    completedCount, // Derived count
    isLeader,       // True if this tab maintains the WebSocket connection
    toggleTodo,     // Action: router.patch('/todos/:id', ...) with optimistic update
    deleteTodo,     // Action: router.delete('/todos/:id') with optimistic update
  } = useTodoActions()
  
  return (
    <div>
      <p>{completedCount} of {todoCount} completed</p>
      {/* Use Inertia's Form component for creating todos */}
      <Form action="/todos" method="post" resetOnSuccess>
        <input type="text" name="todo[title]" placeholder="New task" />
        <button type="submit">Add</button>
      </Form>
      <ul>
        {todos.map(todo => (
          <li key={todo.id}>
            <input 
              type="checkbox" 
              checked={todo.completed} 
              onChange={() => toggleTodo(todo)} 
            />
            {todo.title}
            <button onClick={() => deleteTodo(todo.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

### Using the Event Log Hook

```typescript
import { useEventLog, useLogWriter } from '../hooks/useEventLog'
import type { LogCategory } from '../types'

// Full hook (for components that display logs)
function LogViewer() {
  const { logs, addLog, clearLogs } = useEventLog()
  return (
    <div>
      <button onClick={clearLogs}>Clear</button>
      {logs.map(log => <p key={log.id}>{log.message}</p>)}
    </div>
  )
}

// Lightweight hook (for components that only write logs)
function SomeComponent() {
  const addLog = useLogWriter()
  
  const handleAction = () => {
    // LogCategory: 'cable' | 'broadcast' | 'leader' | 'follower'
    addLog('broadcast', 'User clicked button')
  }
  
  return <button onClick={handleAction}>Click me</button>
}
```

### Triggering a Broadcast (Backend)

```ruby
# In any controller or service
BroadcastTodosJob.perform_later
```
