module Api
  # JSON-only endpoints for the React app. Deliberately not ApplicationController:
  # its allow_browser check answers 406 with an HTML page.
  #
  # ActionController::API has no cookies and no CSRF check. When login is added, include
  # what it needs here: the Rails authentication generator only touches ApplicationController.
  class BaseController < ActionController::API
  end
end
