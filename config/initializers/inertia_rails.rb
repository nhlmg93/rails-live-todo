# frozen_string_literal: true

InertiaRails.configure do |config|
  # Include empty errors hash in all responses (required in InertiaRails 4.0+)
  config.always_include_errors_hash = true
end
