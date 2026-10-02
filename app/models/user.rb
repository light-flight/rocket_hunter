class User < ApplicationRecord
  has_many :sessions, dependent: :destroy
  has_many :invitations, dependent: :destroy
  has_many :sign_in_attempts, dependent: :destroy
  belongs_to :invited_by, class_name: "User", optional: true
  has_many :invitees, class_name: "User", foreign_key: :invited_by_id, dependent: :nullify

  validates :telegram_id, :name, presence: true

  # Takes the "from" object of a Telegram update. Always returns something: a name that fails
  # validation would answer the webhook with a 500, and Telegram repeats such updates.
  def self.name_from(telegram_from)
    full_name = telegram_from.values_at("first_name", "last_name").compact_blank.join(" ")
    full_name.presence || telegram_from["username"].presence || "Менеджер"
  end
end
