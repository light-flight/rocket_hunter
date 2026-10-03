# The pits of a race: every kart dropped into a corridor and every unknown kart put there by
# hand, in order, as the phone that enters them keeps them. count is how much of it stands; the
# moves after it were undone and can be done again. The phone owns the log: it sends the whole
# of it after each change, and the other phones of the team take it from here.
class PitLog < ApplicationRecord
  # A long race with a pit window every few minutes stays far below.
  MOVES_LIMIT = 5000
  KART = /\A\d{1,3}[A-Z]?\z/

  belongs_to :race

  validates :count, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :moves_make_sense

  private
    def moves_make_sense
      return errors.add(:moves, :invalid) unless moves.is_a?(Array) && moves.size <= MOVES_LIMIT
      return errors.add(:count, :invalid) if count.to_i > moves.size

      corridors = Race::LANES.map { it - 1 }
      valid = moves.all? do |move|
        move.is_a?(Hash) && move.keys.sort == %w[ kart lane ] && corridors.include?(move["lane"]) &&
          (move["kart"].nil? || (move["kart"].is_a?(String) && move["kart"].match?(KART)))
      end
      errors.add(:moves, :invalid) unless valid
    end
end
