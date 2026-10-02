class Invitation < ApplicationRecord
  LIFETIME = 3.days

  belongs_to :user, optional: true

  # 24 characters: fits the 64 that Telegram allows in the start parameter of a link.
  has_secure_token

  scope :active, -> { where(created_at: LIFETIME.ago..) }

  # A link lets in one person: the row is locked and destroyed together with creating the manager.
  def self.accept(token, telegram_id:, name:, username:)
    transaction do
      if invitation = active.lock.find_by(token: token)
        invitation.destroy!
        User.create!(telegram_id: telegram_id, name: name, username: username, invited_by: invitation.user)
      end
    end
  end

  def url
    "https://t.me/#{Rails.configuration.x.telegram.bot_username}?start=#{token}"
  end
end
