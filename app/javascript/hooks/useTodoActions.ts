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
