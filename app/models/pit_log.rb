# The pits of a race, by the regulation: a move {lane, kart: "N"} is team N that came into that
# corridor, joined its end and went out on the kart at its front, so the karts change hands and the
# number stays on the track; a move {lane, kart: null} is a spare kart put there by hand. The phone
# that enters a move gives it an id, the same everywhere, and the time it was entered by its clock.
# The log is two lists that only grow at their end: every move any phone entered, and the ids of the
# moves undone. Any phone of the team may enter: each sends what it did and reads what the others did,
# and the log here takes in what it does not have yet. So a move sent twice is kept once, and one
# undone stays undone whatever another phone sends after. Which moves stand, and in what order, the
# phones work out (frontend/src/pitlane.ts).
class PitLog < ApplicationRecord
  # A day-long race of 60 teams that each stop every 15 minutes is 5760 moves.
  MOVES_LIMIT = 10_000
  KART = /\A\d{1,3}[A-Z]?\z/
  ID = /\A[A-Za-z0-9-]{1,64}\z/
  # Any corridor a race can have, not only the ones it has now: a race given fewer corridors later
  # keeps the moves of the rest, and every move sent after that must still be taken.
  CORRIDORS = Race::LANES.map { it - 1 }
  # A phone's numbers are floating point: a time past this would not come back as it went.
  LAST_AT = 2**53 - 1

  belongs_to :race

  validate :moves_make_sense, :undone_make_sense

  # Takes in what a phone sends: the moves whose ids are not here yet, the first copy of each, and the
  # undone ids not here yet. Anything that is not a move is taken too, so that the log is refused.
  def take(moves, undone)
    known = self.moves.to_set { it["id"] }
    self.moves += moves.select { !move?(it) || known.add?(it["id"]) }
    self.undone |= undone
  end

  private
    def moves_make_sense
      errors.add(:moves, :invalid) unless list?(moves) && moves.all? { move?(it) } && unique?(moves.map { it["id"] })
    end

    # An undone id may name a move not here yet: the phone that undid it may send the move later.
    def undone_make_sense
      errors.add(:undone, :invalid) unless list?(undone) && undone.all? { id?(it) } && unique?(undone)
    end

    def list?(list)
      list.is_a?(Array) && list.size <= MOVES_LIMIT
    end

    def unique?(ids)
      ids.uniq.size == ids.size
    end

    def id?(id)
      id.is_a?(String) && id.match?(ID)
    end

    def move?(move)
      move.is_a?(Hash) && move.keys.sort == %w[ at id kart lane ] && id?(move["id"]) &&
        move["lane"].is_a?(Integer) && CORRIDORS.include?(move["lane"]) &&
        (move["kart"].nil? || (move["kart"].is_a?(String) && move["kart"].match?(KART))) &&
        move["at"].is_a?(Integer) && move["at"].between?(0, LAST_AT)
    end
end
