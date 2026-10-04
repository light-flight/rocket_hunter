# Copies a manager's Telegram profile photo after joining or signing in. Without it the app
# draws the first letter of the name, so a Telegram out of reach is tried only a few times.
class RefreshAvatarJob < ApplicationJob
  retry_on TelegramBot::Unavailable, wait: :polynomially_longer, attempts: 3
  discard_on ActiveJob::DeserializationError

  def perform(user_id)
    User.find_by(id: user_id)&.refresh_avatar
  end
end
