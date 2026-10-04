class User < ApplicationRecord
  # Telegram makes a profile photo in several sizes: the smallest of them that is still sharp
  # in a circle of 44 points on a phone of three pixels to a point.
  AVATAR_WIDTH = 160
  AVATAR_LIMIT = 1.megabyte

  has_many :sessions, dependent: :destroy
  has_many :invitations, dependent: :destroy
  has_many :sign_in_attempts, dependent: :destroy
  has_one :avatar, dependent: :delete
  belongs_to :invited_by, class_name: "User", optional: true
  has_many :invitees, class_name: "User", foreign_key: :invited_by_id, dependent: :nullify

  validates :telegram_id, :name, presence: true

  # Takes the "from" object of a Telegram update. Always returns something: a name that fails
  # validation would answer the webhook with a 500, and Telegram repeats such updates.
  def self.name_from(telegram_from)
    full_name = telegram_from.values_at("first_name", "last_name").compact_blank.join(" ")
    full_name.presence || telegram_from["username"].presence || "Менеджер"
  end

  # The bot only learns the photo by asking Telegram, which the webhook never does.
  def refresh_avatar_later
    RefreshAvatarJob.perform_later(id) if TelegramBot.configured?
  end

  # Copies the manager's current Telegram profile photo. A manager who has none, or shows it
  # only to contacts, has none here either: the phones then draw the first letter of the name.
  def refresh_avatar(bot: TelegramBot.new)
    sizes = bot.call("getUserProfilePhotos", user_id: telegram_id, limit: 1)["photos"].first
    size = sizes&.select { it["width"].to_i >= AVATAR_WIDTH }&.min_by { it["width"].to_i } || sizes&.max_by { it["width"].to_i }

    if size.nil?
      Avatar.where(user_id: id).delete_all
    elsif Avatar.where(user_id: id, telegram_file_id: size["file_unique_id"]).none?
      data = bot.download(bot.call("getFile", file_id: size["file_id"])["file_path"], limit: AVATAR_LIMIT)
      # Telegram keeps profile photos as JPEG; anything else is not shown.
      raise TelegramBot::Error, "the profile photo is not a JPEG" unless data.start_with?("\xFF\xD8\xFF".b)

      Avatar.upsert({ user_id: id, telegram_file_id: size["file_unique_id"], data: data,
        checksum: Digest::SHA256.hexdigest(data) }, unique_by: :user_id)
    end
  end

  # The address the phones load the photo from, or nil. It changes with the photo.
  def avatar_url
    checksum = Avatar.where(user_id: id).pick(:checksum)
    "/api/avatar?v=#{checksum.first(16)}" if checksum
  end
end
