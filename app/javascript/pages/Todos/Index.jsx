import { useState, useRef } from 'react'
import { useAtom } from 'jotai'
import { useTodoSync } from '../../hooks/useTodoSync'
import { todoCountAtom, completedCountAtom } from '../../atoms/todos'
import { EventLog } from '../../components/EventLog'
import { LeaderBadge } from '../../components/LeaderBadge'
import './Index.css'

export default function Index({ todos: initialTodos }) {
  const { todos } = useTodoSync(initialTodos)
  const [todoCount] = useAtom(todoCountAtom)
  const [completedCount] = useAtom(completedCountAtom)
  const [newTitle, setNewTitle] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef(null)

  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!newTitle.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      const response = await fetch('/todos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ todo: { title: newTitle.trim() } }),
      })

      if (response.ok) {
        setNewTitle('')
        inputRef.current?.focus()
      }
    } catch (error) {
      console.error('Failed to create todo:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleToggle = async (todo) => {
    try {
      await fetch(`/todos/${todo.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ todo: { completed: !todo.completed } }),
      })
    } catch (error) {
      console.error('Failed to update todo:', error)
    }
  }

  const handleDelete = async (todoId) => {
    try {
      await fetch(`/todos/${todoId}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
      })
    } catch (error) {
      console.error('Failed to delete todo:', error)
    }
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

      <form onSubmit={handleSubmit} className="todos-form">
        <input
          ref={inputRef}
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="What needs to be done?"
          className="todos-input"
          disabled={isSubmitting}
        />
        <button type="submit" className="todos-add-button" disabled={isSubmitting}>
          {isSubmitting ? '...' : 'Add'}
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
              <span className={`todos-text ${todo.completed ? 'todos-text--completed' : ''}`}>
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
  )
}
