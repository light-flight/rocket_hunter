# A sign-in started in the app and waiting for a manager to confirm it in the Telegram bot.
class SignInAttempt < ApplicationRecord
  LIFETIME = 5.minutes

  belongs_to :user, optional: true

  has_secure_token

  scope :active, -> { where(created_at: LIFETIME.ago..) }

  # Expired rows are swept here, so no recurring job is needed.
  def self.start(user_agent:)
    where(created_at: ...LIFETIME.ago).delete_all
    create!(user_agent: user_agent)
  end

  def url
    "https://t.me/#{Rails.configuration.x.telegram.bot_username}?start=#{token}"
  end

  # Shown in the bot's confirm prompt, so a manager can tell his own phone from somebody else's.
  def device
    case user_agent
    when /iPhone/ then "iPhone"
    when /Android/ then "Android"
    when /Macintosh/ then "Mac"
    when /Windows/ then "Windows"
    else "неизвестное устройство"
    end
  end
end
