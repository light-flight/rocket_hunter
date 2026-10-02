require "net/http"

# The only place that calls Telegram: the app itself answers the bot's updates in the
# webhook response. Run in production: bin/kamal app exec --reuse 'bin/rails telegram:set_webhook'
namespace :telegram do
  desc "Tell Telegram to send the bot's updates to the production webhook"
  task set_webhook: :environment do
    secret = Rails.application.credentials.dig(:telegram, :webhook_secret)
    abort "telegram.webhook_secret is missing from the credentials (bin/rails credentials:edit)" if secret.blank?

    puts telegram_api("setWebhook",
      url: "https://app.rocket-hunter.ru/telegram/webhook",
      secret_token: secret,
      allowed_updates: %w[ message callback_query ],
      # The default of 40 parallel deliveries would swamp 3 Puma threads.
      max_connections: 2)
  end

  desc "Show what Telegram knows about the bot's webhook"
  task webhook_info: :environment do
    puts telegram_api("getWebhookInfo")
  end

  # Never print the request URL: the bot token is in its path.
  def telegram_api(method, **params)
    token = Rails.application.credentials.dig(:telegram, :bot_token)
    abort "telegram.bot_token is missing from the credentials (bin/rails credentials:edit)" if token.blank?
    # Checked here because URI() quotes the whole address, token included, when it cannot parse it.
    abort "telegram.bot_token in the credentials does not look like a bot token (123456:ABC...)" unless token.match?(/\A\d+:[\w-]+\z/)

    uri = URI("https://api.telegram.org/bot#{token}/#{method}")
    Net::HTTP.post(uri, params.to_json, "Content-Type" => "application/json").body
  end
end
