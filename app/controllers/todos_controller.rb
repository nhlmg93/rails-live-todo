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
      redirect_to todos_path
    else
      redirect_to todos_path, inertia: { errors: todo.errors.full_messages }
    end
  end

  def update
    todo = Todo.find(params[:id])
    if todo.update(todo_params)
      broadcast_update_async
      redirect_to todos_path
    else
      redirect_to todos_path, inertia: { errors: todo.errors.full_messages }
    end
  end

  def destroy
    Todo.find(params[:id]).destroy
    broadcast_update_async
    redirect_to todos_path
  end

  private

  def todo_params
    params.require(:todo).permit(:title, :completed)
  end

  def broadcast_update_async
    BroadcastTodosJob.perform_later
  end
end
