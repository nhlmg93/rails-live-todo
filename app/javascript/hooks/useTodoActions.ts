import { useEffect, useRef, useCallback, useMemo, useEffectEvent } from 'react'
import { useAtom } from 'jotai'
import { router, usePage } from '@inertiajs/react'
import consumer from '../channels/consumer'
import { useLeaderElection } from './useLeaderElection'
import { isLeaderAtom } from '../atoms/todos'
import { useLogWriter } from './useEventLog'
import type { Todo, PageProps } from '../types'
import type { Subscription } from '@rails/actioncable'

/**
 * Update Inertia page props with new todos (used by ActionCable and BroadcastChannel)
 */
const updateTodos = (todos: Todo[]) => {
  router.replace({
    preserveScroll: true,
    preserveState: true,
    props: (current) => ({ ...current, todos }),
  })
}

interface CableData {
  todos?: Todo[]
}

/**
 * Unified hook for todo state and actions.
 * Handles syncing across browser tabs via ActionCable + leader election,
 * and provides CRUD actions via Inertia router.
 */
export function useTodoActions() {
  const { todos } = usePage<PageProps>().props
  const [isLeader] = useAtom(isLeaderAtom)
  const addLog = useLogWriter()
  const subscriptionRef = useRef<Subscription | null>(null)

  // Derived counts
  const todoCount = useMemo(() => todos?.length ?? 0, [todos])
  const completedCount = useMemo(
    () => todos?.filter((todo) => todo.completed).length ?? 0,
    [todos]
  )

  const { broadcast } = useLeaderElection('todos-sync', {
    onMessage: useCallback((data: Todo[]) => updateTodos(data), []),
  })

  // Effect Events for ActionCable callbacks (non-reactive)
  const onConnected = useEffectEvent(() => {
    addLog('cable', 'Connected to TodosChannel')
  })

  const onDisconnected = useEffectEvent(() => {
    addLog('cable', 'Disconnected from TodosChannel')
  })

  const onReceived = useEffectEvent((data: CableData) => {
    if (data.todos) {
      addLog('cable', `Received ${data.todos.length} todos`)
      updateTodos(data.todos)
      broadcast(data.todos)
      addLog('broadcast', 'Relayed todos to followers')
    }
  })

  // ActionCable subscription (leader only)
  useEffect(() => {
    if (!isLeader) {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = null
      return
    }

    subscriptionRef.current = consumer.subscriptions.create('TodosChannel', {
      connected: onConnected,
      disconnected: onDisconnected,
      received: onReceived,
    })

    return () => {
      subscriptionRef.current?.unsubscribe()
    }
  }, [isLeader])

  return {
    todos: todos ?? [],
    todoCount,
    completedCount,
    isLeader,
  }
}
