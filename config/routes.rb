Rails.application.routes.draw do
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # JSON API for the React app (frontend/), which Rails serves as static files from public/.
  namespace :api do
    get "health" => "health#show"
    resource  :session,         only: %i[ show create destroy ]
    resource  :sign_in_attempt, only: :create
    resources :invitations,     only: :create
    # The id is made on the phone; anything that is not a UUID is not a race.
    resources :races,           only: %i[ index update ], constraints: { id: /\h{8}-\h{4}-\h{4}-\h{4}-\h{12}/ }
  end

  # Bot updates from Telegram: not a browser endpoint, no cookie, no same-origin check.
  namespace :telegram do
    resource :webhook, only: :create
  end
end
