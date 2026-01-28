import { FormEvent } from "react";
import { useForm, router } from "@inertiajs/react";
import { useTodoActions } from "../../hooks/useTodoActions";
import { EventLog } from "../../components/EventLog";
import { LeaderBadge } from "../../components/LeaderBadge";
import type { Todo } from "../../types";
import "./Index.css";

export default function Index() {
  const { todos, todoCount, completedCount } = useTodoActions();

  const { data, setData, post, processing, reset } = useForm({
    todo: { title: "" },
  });

  const handleCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!data.todo.title.trim()) return;

    post("/todos", {
      preserveScroll: true,
      onSuccess: () => reset(),
    });
  };

  const handleToggle = (todo: Todo) => {
    router.patch(
      `/todos/${todo.id}`,
      { todo: { completed: !todo.completed } },
      { preserveScroll: true }
    );
  };

  const handleDelete = (todoId: number) => {
    router.delete(`/todos/${todoId}`, { preserveScroll: true });
  };

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

      <form onSubmit={handleCreate} className="todos-form">
        <input
          type="text"
          value={data.todo.title}
          onChange={(e) => setData("todo", { title: e.target.value })}
          placeholder="What needs to be done?"
          className="todos-input"
          disabled={processing}
        />
        <button
          type="submit"
          className="todos-add-button"
          disabled={processing}
        >
          Add
        </button>
      </form>

      <ul className="todos-list">
        {todos.map((todo) => (
          <li key={todo.id} className="todos-item">
            <label className="todos-label">
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => handleToggle(todo)}
                className="todos-checkbox"
              />
              <span
                className={`todos-text ${todo.completed ? "todos-text--completed" : ""}`}
              >
                {todo.title}
              </span>
            </label>
            <button
              onClick={() => handleDelete(todo.id)}
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
