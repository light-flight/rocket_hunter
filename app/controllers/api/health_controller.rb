module Api
  # Lets the app tell "server reachable and its database answers" from "no network".
  class HealthController < BaseController
    allow_unauthenticated_access

    def show
      ActiveRecord::Base.with_connection { |connection| connection.select_value("SELECT 1") }
      render json: { status: "ok" }
    end
  end
end
