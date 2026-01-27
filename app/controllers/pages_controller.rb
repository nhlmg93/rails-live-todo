class PagesController < ApplicationController
  layout "inertia"

  def index
    render inertia: "Home", props: {
      name: "World"
    }
  end
end
