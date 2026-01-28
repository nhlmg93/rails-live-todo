# AGENTS.md

Guidelines for AI coding agents working in this repository.

## Project Overview

Rails 8 + React 19 real-time todo app using:
- **Backend**: Ruby 4.0.1, Rails 8.1.2, SQLite3 (all-SQLite stack)
- **Frontend**: TypeScript, React 19, Vite
- **Bridge**: Inertia.js (server-driven SPA)
- **Real-time**: ActionCable + Solid Cable (SQLite-backed WebSockets)
- **State**: Jotai (client-side), Inertia props (server data)
- **Jobs**: Solid Queue (SQLite-backed background jobs)

## Build/Lint/Test Commands

### Development
```bash
bin/dev                    # Start Rails + Vite dev servers (use this)
bin/rails server           # Rails only
bin/vite dev               # Vite only
```

### Testing
```bash
bin/rails test                              # Run all tests
bin/rails test test/models/todo_test.rb    # Run single file
bin/rails test test/models/todo_test.rb:10 # Run test at line
bin/rails test -n "/pattern/"              # Run matching tests
bin/rails test:system                       # System tests (Capybara)
```

### Linting
```bash
bin/rubocop                # Ruby linting (Rails Omakase style)
bin/rubocop -a             # Auto-fix Ruby issues
npx tsc --noEmit           # TypeScript type checking
```

### CI/Security
```bash
bin/ci                     # Full CI suite (lint, security, tests)
bin/brakeman               # Ruby security scan
bin/bundler-audit          # Gem vulnerability audit
```

## Directory Structure (Active Code Only)

```
app/
├── channels/
│   ├── application_cable/     # ActionCable base classes
│   └── todos_channel.rb       # Real-time todo updates
├── controllers/
│   ├── application_controller.rb
│   └── todos_controller.rb    # Main CRUD controller
├── javascript/
│   ├── atoms/todos.ts         # Jotai atoms (isLeaderAtom)
│   ├── channels/consumer.ts   # ActionCable consumer
│   ├── components/            # React components + co-located CSS
│   ├── entrypoints/inertia.tsx # App entry point
│   ├── hooks/                 # Custom hooks (useTodoActions, etc.)
│   ├── pages/Todos/Index.tsx  # Main page component
│   └── types/index.ts         # TypeScript interfaces
├── jobs/
│   └── broadcast_todos_job.rb # WebSocket broadcast job
├── models/
│   └── todo.rb                # Todo model with caching
└── views/layouts/inertia.html.erb
```

## TypeScript Code Style

### Import Order
1. React/framework imports (react, jotai, @inertiajs/react)
2. Local modules (components, hooks, atoms, channels)
3. Type imports (use `import type` syntax)

```typescript
import { useEffect, useCallback } from "react";
import { useAtom } from "jotai";
import { router, usePage } from "@inertiajs/react";
import { useLeaderElection } from "./useLeaderElection";
import type { Todo, PageProps } from "../types";
```

### Naming Conventions
| Element | Convention | Example |
|---------|-----------|---------|
| Components | PascalCase | `LeaderBadge`, `EventLog` |
| Hooks | camelCase + `use` prefix | `useTodoActions` |
| Atoms | camelCase + `Atom` suffix | `isLeaderAtom` |
| Interfaces | PascalCase | `Todo`, `PageProps` |
| Type aliases | PascalCase | `LogCategory` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_LOGS`, `TAB_ID` |
| CSS classes | BEM | `leader-badge__icon` |

### Component Pattern
```typescript
// Named export for reusable components
export function LeaderBadge() { ... }

// Default export for pages
export default function Index() { ... }
```

### Types
- Use `interface` for data structures and props
- Use `type` for unions: `type LogCategory = 'cable' | 'broadcast'`
- Always use `import type` for type-only imports
- Explicitly type refs: `useRef<Subscription | null>(null)`

### Error Handling (Optimistic Updates)
```typescript
const toggleTodo = useCallback((todo: Todo) => {
  const previous = todo.completed;
  
  // Optimistic update
  router.replaceProp("todos", (todos: Todo[]) =>
    todos.map((t) => t.id === todo.id ? { ...t, completed: !previous } : t)
  );

  router.patch(`/todos/${todo.id}`, { todo: { completed: !previous } }, {
    preserveScroll: true,
    onError: () => {
      // Revert on error
      router.replaceProp("todos", (todos: Todo[]) =>
        todos.map((t) => t.id === todo.id ? { ...t, completed: previous } : t)
      );
    },
  });
}, []);
```

### TypeScript Config
- Strict mode enabled
- `noUnusedLocals` and `noUnusedParameters` enforced
- Path alias: `@/*` maps to `app/javascript/*`

## Ruby Code Style

### General
- Rails Omakase style (rubocop-rails-omakase)
- Use `frozen_string_literal: true` comment
- Standard Rails MVC patterns

### Controller Pattern
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

  private

  def todo_params
    params.require(:todo).permit(:title, :completed)
  end

  def broadcast_update_async
    BroadcastTodosJob.perform_later
  end
end
```

### Model Pattern
```ruby
class Todo < ApplicationRecord
  CACHE_KEY = "todos:broadcast_list"

  validates :title, presence: true
  scope :ordered, -> { order(created_at: :desc) }
  after_commit :invalidate_cache

  def self.broadcast_list
    Rails.cache.fetch(CACHE_KEY, expires_in: 1.hour) do
      ordered.as_json(only: %i[id title completed created_at])
    end
  end
end
```

## Architecture Notes

### Inertia.js Flow
- Server renders props, client renders React components
- Use `usePage<PageProps>().props` for server data
- Use `router.patch/post/delete` for mutations
- Use `router.replaceProp` for optimistic updates

### Real-time Updates
- Leader tab subscribes to ActionCable
- Leader broadcasts to follower tabs via BroadcastChannel API
- Only one WebSocket connection per browser (efficiency)

### State Management
- Jotai: Client-only state (leader election)
- Inertia props: Server-provided data (todos)
- No Redux/Context needed
