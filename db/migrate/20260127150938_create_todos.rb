class CreateTodos < ActiveRecord::Migration[8.1]
  def change
    create_table :todos do |t|
      t.string :title
      t.boolean :completed, default: false, null: false

      t.timestamps
    end
  end
end
