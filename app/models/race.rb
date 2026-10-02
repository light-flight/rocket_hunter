# One race weekend. Every manager of the team sees every race; the work at the track is done
# inside one of them.
class Race < ApplicationRecord
  NAME_LIMIT = 100

  # Control characters too: PostgreSQL refuses a NUL in a string.
  normalizes :name, with: ->(name) { name.gsub(/[[:cntrl:]]/, " ").squish }

  validates :name, presence: true, length: { maximum: NAME_LIMIT }
end
