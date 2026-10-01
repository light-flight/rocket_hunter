module Api
  # JSON-only endpoints for the React app. Deliberately not ApplicationController:
  # its allow_browser check answers 406 with an HTML page.
  class BaseController < ActionController::API
  end
end
