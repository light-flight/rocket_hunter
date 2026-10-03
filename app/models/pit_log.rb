# The pits of a race, by the regulation: a move {lane, "N"} is team N that came into that
# corridor, joined its end and went out on the kart at its front, so the karts change hands and
# the number stays on the track; a move {lane, null} is a spare kart put there by hand. The moves
# are kept in order, and count is how much of it stands: the moves after it were undone and can
# be done again. Any phone of the team may enter moves. A phone sends the whole log with the
# version it is based on, and one that is behind is told to merge its changes into the log here
# first, so no phone writes over the moves of another.
class PitLog < ApplicationRecord
  # A day-long race of 60 teams that each stop every 15 minutes is 5760 moves.
  MOVES_LIMIT = 10_000
  KART = /\A\d{1,3}[A-Z]?\z/

  belongs_to :race

  validates :count, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :version, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :moves_make_sense

  private
    def moves_make_sense
      return errors.add(:moves, :invalid) unless moves.is_a?(Array) && moves.size <= MOVES_LIMIT
      return errors.add(:count, :invalid) if count.to_i > moves.size

      # Any corridor a race can have, not only the ones it has now: a race given fewer corridors
      # later keeps the moves of the rest, and every log sent after that must still be taken.
      corridors = Race::LANES.map { it - 1 }
      valid = moves.all? do |move|
        move.is_a?(Hash) && move.keys.sort == %w[ kart lane ] && corridors.include?(move["lane"]) &&
          (move["kart"].nil? || (move["kart"].is_a?(String) && move["kart"].match?(KART)))
      end
      errors.add(:moves, :invalid) unless valid
    end
end
