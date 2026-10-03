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
    # Ids are made on the phone; anything that is not a UUID is not a race, nor a file.
    uuid = /\h{8}-\h{4}-\h{4}-\h{4}-\h{12}/
    resources :races, only: %i[ index update ], constraints: { id: uuid } do
      resources :qualification_files, only: %i[ index update destroy ], constraints: { race_id: uuid, id: uuid } do
        post :read, on: :member
      end
      resource :pit_log, only: %i[ show update ], constraints: { race_id: uuid }
    end
  end

  # Bot updates from Telegram: not a browser endpoint, no cookie, no same-origin check.
  namespace :telegram do
    resource :webhook, only: :create
  end
end
