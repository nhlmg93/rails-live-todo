# frozen_string_literal: true

class TodosController < ApplicationController
  layout "inertia"

  def index
    render inertia: "Todos/Index", props: { todos: Todo.broadcast_list }
  end

  def create
    todo = Todo.new(todo_params)
    if todo.save
      broadcast_update_async
      render json: todo.as_json(only: %i[id title completed created_at]), status: :created
    else
      render json: { errors: todo.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def update
    todo = Todo.find(params[:id])
    if todo.update(todo_params)
      broadcast_update_async
      render json: todo.as_json(only: %i[id title completed created_at])
    else
      render json: { errors: todo.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def destroy
    Todo.find(params[:id]).destroy
    broadcast_update_async
    head :no_content
  end

  private

  def todo_params
    params.require(:todo).permit(:title, :completed)
  end

  def broadcast_update_async
    BroadcastTodosJob.perform_later
  end
end
