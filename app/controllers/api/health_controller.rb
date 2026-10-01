module Api
  # Lets the app tell "server reachable" from "no network".
  class HealthController < BaseController
    def show
      ActiveRecord::Base.connection.select_value("SELECT 1")
      render json: { status: "ok" }
    end
  end
end
