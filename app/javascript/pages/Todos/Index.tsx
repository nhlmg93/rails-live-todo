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
