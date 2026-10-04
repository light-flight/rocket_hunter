require_relative "boot"

require "rails/all"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

module RocketHunter
  class Application < Rails::Application
    # Initialize configuration defaults for originally generated Rails version.
    config.load_defaults 8.1

    # Please, add to the `ignore` list any other `lib` subdirectories that do
    # not contain `.rb` files, or that should not be reloaded or eager loaded.
    # Common ones are `templates`, `generators`, or `middleware`, for example.
    config.autoload_lib(ignore: %w[assets tasks])

    # Configuration for the application, engines, and railties goes here.
    #
    # These settings can be overridden in specific environments using the files
    # in config/environments, which are processed later.
    #
    # config.time_zone = "Central Time (US & Canada)"
    # config.eager_load_paths << Rails.root.join("extras")

    # The bot behind sign-in and invitations. Public: it is part of every t.me link.
    config.x.telegram.bot_username = "rocket_hunter_auth_bot"
    # Secret: only background jobs and rake tasks call Telegram with it. Without it the app
    # still signs managers in, it just shows no Telegram profile photos.
    config.x.telegram.bot_token = credentials.dig(:telegram, :bot_token).presence

    # The model that reads qualification protocols, and its API key: in the credentials
    # (anthropic.api_key) or in ANTHROPIC_API_KEY.
    config.x.qualification.model = ENV.fetch("QUALIFICATION_MODEL", "claude-opus-5-5")
    config.x.qualification.api_key = credentials.dig(:anthropic, :api_key).presence || ENV["ANTHROPIC_API_KEY"].presence
  end
end
