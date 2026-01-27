import { useEffect, useRef, useCallback, useMemo, useEffectEvent } from 'react'
import { useAtom } from 'jotai'
import { router, usePage } from '@inertiajs/react'
import consumer from '../channels/consumer'
import { useLeaderElection } from './useLeaderElection'
import { isLeaderAtom } from '../atoms/todos'
import { useLogWriter } from './useEventLog'

/**
 * Update Inertia page props with new todos (used by ActionCable and BroadcastChannel)
 */
const updateTodos = (todos) => {
  router.replace({
    preserveScroll: true,
    preserveState: true,
    props: (current) => ({ ...current, todos }),
  })
}

/**
 * Unified hook for todo state and actions.
 * Handles syncing across browser tabs via ActionCable + leader election,
 * and provides CRUD actions via Inertia router.
 */
export function useTodoActions() {
  const { todos } = usePage().props
  const [isLeader] = useAtom(isLeaderAtom)
  const addLog = useLogWriter()
  const subscriptionRef = useRef(null)

  // Derived counts
  const todoCount = useMemo(() => todos?.length ?? 0, [todos])
  const completedCount = useMemo(
    () => todos?.filter((todo) => todo.completed).length ?? 0,
    [todos]
  )

  const { broadcast } = useLeaderElection('todos-sync', {
    onMessage: useCallback((data) => updateTodos(data), []),
  })

  // Effect Events for ActionCable callbacks (non-reactive)
  const onConnected = useEffectEvent(() => {
    addLog('cable', 'Connected to TodosChannel')
  })

  const onDisconnected = useEffectEvent(() => {
    addLog('cable', 'Disconnected from TodosChannel')
  })

  const onReceived = useEffectEvent((data) => {
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

    return () => subscriptionRef.current?.unsubscribe()
  }, [isLeader])

  // Action creators - use Inertia router directly
  const createTodo = useCallback((title) => {
    router.post('/todos', { todo: { title: title.trim() } }, { preserveScroll: true })
  }, [])

  const toggleTodo = useCallback((todo) => {
    router.patch(
      `/todos/${todo.id}`,
      { todo: { completed: !todo.completed } },
      { preserveScroll: true }
    )
  }, [])

  const deleteTodo = useCallback((todoId) => {
    router.delete(`/todos/${todoId}`, { preserveScroll: true })
  }, [])

  return {
    todos: todos ?? [],
    todoCount,
    completedCount,
    isLeader,
    createTodo,
    toggleTodo,
    deleteTodo,
  }
}
