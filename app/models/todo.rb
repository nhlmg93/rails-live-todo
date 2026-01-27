class Todo < ApplicationRecord
  CACHE_KEY = "todos:broadcast_list"

  validates :title, presence: true

  scope :ordered, -> { order(created_at: :desc) }

  # Invalidate cache after any change
  after_commit :invalidate_cache

  def self.broadcast_list
    Rails.cache.fetch(CACHE_KEY, expires_in: 1.hour) do
      ordered.as_json(only: %i[id title completed created_at])
    end
  end

  def self.invalidate_broadcast_cache
    Rails.cache.delete(CACHE_KEY)
  end

  private

  def invalidate_cache
    self.class.invalidate_broadcast_cache
  end
end
