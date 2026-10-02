# One race weekend. Every manager of the team sees every race; the work at the track is done
# inside one of them.
class Race < ApplicationRecord
  NAME_LIMIT = 100

  normalizes :name, with: ->(name) { name.squish }

  validates :name, presence: true, length: { maximum: NAME_LIMIT }
end
