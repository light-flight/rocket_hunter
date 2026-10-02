# One race weekend. Every manager of the team sees every race; the work at the track is done
# inside one of them.
class Race < ApplicationRecord
  NAME_LIMIT = 100
  # Corridors in the pit lane: almost always one or two.
  LANES = 1..3

  has_many :qualification_files, dependent: :delete_all

  # Control characters too: PostgreSQL refuses a NUL in a string.
  normalizes :name, with: ->(name) { name.gsub(/[[:cntrl:]]/, " ").squish }

  validates :name, presence: true, length: { maximum: NAME_LIMIT }
  validates :lanes, inclusion: { in: LANES }
end
