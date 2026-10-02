module Api
  # JSON-only endpoints for the React app. Deliberately not ApplicationController:
  # its allow_browser check answers 406 with an HTML page.
  #
  # Every action needs a session unless its controller calls allow_unauthenticated_access.
  # ActionController::API has no CSRF check and the app sends no token: requests from
  # other sites are refused by verify_same_origin instead.
  class BaseController < ActionController::API
    include ActionController::Cookies
    include Authentication

    before_action :verify_same_origin

    private
      # Rails 8.2 ships this as protect_from_forgery using: :header_only.
      # GET routes must stay free of side effects: Rack::MethodOverride lets a POST pose as GET.
      def verify_same_origin
        return if request.get? || request.head?

        site = request.headers["Sec-Fetch-Site"]
        same_origin = site ? site == "same-origin" : (request.origin.nil? || request.origin == request.base_url)
        head :forbidden unless same_origin
      end
  end
end
