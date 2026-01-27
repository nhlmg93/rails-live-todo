import { useEffect, useRef, useCallback } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import consumer from '../channels/consumer'
import { useLeaderElection } from './useLeaderElection'
import { todosAtom, isLeaderAtom } from '../atoms/todos'
import { addLogAtom } from '../atoms/logs'

/**
 * Syncs todos across browser tabs using ActionCable + leader election.
 * Only the leader tab maintains a WebSocket; followers receive updates via BroadcastChannel.
 */
export function useTodoSync(initialTodos) {
  const [todos, setTodos] = useAtom(todosAtom)
  const [isLeader] = useAtom(isLeaderAtom)
  const addLog = useSetAtom(addLogAtom)
  const subscriptionRef = useRef(null)
  const initializedRef = useRef(false)

  // Initialize todos from server-rendered props (only once)
  useEffect(() => {
    if (!initializedRef.current && initialTodos?.length > 0) {
      setTodos(initialTodos)
      initializedRef.current = true
    }
  }, [initialTodos, setTodos])

  const { broadcast } = useLeaderElection('todos-sync', {
    onMessage: useCallback((data) => setTodos(data), [setTodos])
  })

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
          broadcast(data.todos)
          addLog({ category: 'broadcast', message: 'Relayed todos to followers' })
        }
      }
    })

    return () => subscriptionRef.current?.unsubscribe()
  }, [isLeader, broadcast, setTodos, addLog])

  return { todos, isLeader }
}
