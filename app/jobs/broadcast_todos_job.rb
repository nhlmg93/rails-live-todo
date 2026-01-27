# frozen_string_literal: true

class BroadcastTodosJob < ApplicationJob
  queue_as :default

  # Discard job if it fails - stale broadcast data is acceptable
  # since a newer job will likely be queued
  discard_on StandardError

  def perform
    # Re-fetch fresh data (cache was already invalidated by the model callback)
    todos = Todo.broadcast_list
    ActionCable.server.broadcast("todos", { todos: todos })
    Rails.logger.info "[BroadcastTodosJob] Broadcasted #{todos.size} todos"
  end
end
