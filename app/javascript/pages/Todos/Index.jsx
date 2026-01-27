import { useRef } from 'react'
import { useTodoActions } from '../../hooks/useTodoActions'
import { EventLog } from '../../components/EventLog'
import { LeaderBadge } from '../../components/LeaderBadge'
import './Index.css'

export default function Index() {
  const { todos, todoCount, completedCount, createTodo, toggleTodo, deleteTodo } = useTodoActions()
  const formRef = useRef(null)

  const handleSubmit = (e) => {
    e.preventDefault()
    const formData = new FormData(e.target)
    const title = formData.get('title')?.trim()
    if (!title) return

    createTodo(title)
    formRef.current?.reset()
    formRef.current?.querySelector('input')?.focus()
  }

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
          <span className="todos-stat__value">{todoCount - completedCount}</span>
          <span className="todos-stat__label">Remaining</span>
        </div>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} className="todos-form">
        <input
          type="text"
          name="title"
          placeholder="What needs to be done?"
          className="todos-input"
        />
        <button type="submit" className="todos-add-button">
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
                onChange={() => toggleTodo(todo)}
                className="todos-checkbox"
              />
              <span className={`todos-text ${todo.completed ? 'todos-text--completed' : ''}`}>
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
  )
}
