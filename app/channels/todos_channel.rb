# frozen_string_literal: true

class TodosChannel < ApplicationCable::Channel
  def subscribed
    stream_from "todos"
    # Send cached todos immediately on subscribe for instant UI hydration
    transmit(todos: Todo.broadcast_list)
  end
end
