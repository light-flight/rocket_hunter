# The pits of a race, by the regulation: a move {lane, kart: "N"} is team N that came into that
# corridor, joined its end and went out on the kart at its front, so the karts change hands and the
# number stays on the track; a move {lane, kart: null} is a spare kart put there by hand. The phone
# that enters a move gives it an id, the same everywhere, and the time it was entered by its clock.
# The log is two lists that only grow at their end: every move any phone entered, and the ids of the
# moves undone. Any phone of the team may enter: each sends what it did and reads what the others did,
# and the log here takes in what it does not have yet. So a move sent twice is kept once, and one
# undone stays undone whatever another phone sends after. Which moves stand, and in what order, the
# phones work out (frontend/src/pitlane.ts). The log also keeps how many corridors the pit lane has,
# chosen on a phone the first time the pits are opened.
class PitLog < ApplicationRecord
  # A day-long race of 60 teams that each stop every 15 minutes is 5760 stops. Each stays here as many
  # times as phones entered it, and an undo done again adds a move, so there is room for two of each
  # and more.
  MOVES_LIMIT = 25_000
  KART = /\A\d{1,3}[A-Z]?\z/
  ID = /\A[A-Za-z0-9-]{1,64}\z/
  # Corridors in the pit lane: almost always one or two.
  LANES = 1..3
  # Any corridor a race can have, not only the ones it has now: pits started over with fewer
  # corridors keep the moves of the rest, and every move sent after that must still be taken.
  CORRIDORS = LANES.map { it - 1 }
  # A phone's numbers are floating point: a time past this would not come back as it went.
  LAST_AT = 2**53 - 1

  belongs_to :race

  validate :moves_make_sense, :undone_make_sense
  # No corridors: not chosen yet, or to be chosen again after the pits were started over.
  validates :lanes, numericality: { only_integer: true, in: LANES }, allow_nil: true
  validates :lanes_at, numericality: { only_integer: true, in: 0..LAST_AT }

  # Takes in what a phone sends: the moves whose ids are not here yet, the first copy of each, and the
  # undone ids not here yet. Anything that is not a move is taken too, so that the log is refused.
  def take(moves, undone)
    known = self.moves.to_set { it["id"] }
    self.moves += moves.select { !move?(it) || known.add?(it["id"]) }
    self.undone |= undone
  end

  # Takes the corridors a phone chose, or none when it started the pits over, with the time it did so
  # by its clock, when that is later than the choice here: of two phones' choices the later one
  # stands, whichever is heard first. But never over corridors something stands in: once the race is
  # on, only starting the pits over changes them, so a phone that chose before it had heard of the
  # race does not take them away from its stops. What stands is counted after the undo the phone sent
  # with the choice and without the moves it sent: those it entered in the corridors it chose. The
  # phones do the same (replaces in frontend/src/pitlane.ts). A choice that is not one is taken
  # whatever its time, so that the log is refused.
  def take_lanes(lanes, at, sent = [])
    return if choice?(lanes, at) && (at <= lanes_at || (lanes && self.lanes && stands_besides?(sent)))

    self.lanes, self.lanes_at = lanes, at
  end

  private
    def choice?(lanes, at)
      (lanes.nil? || (lanes.is_a?(Integer) && LANES.include?(lanes))) && at.is_a?(Integer) && at.between?(0, LAST_AT)
    end

    # Whether a move stands that is not one of these.
    def stands_besides?(sent)
      ids = sent.filter_map { it["id"] if it.is_a?(Hash) }.to_set
      done = undone.to_set
      moves.any? { it.is_a?(Hash) && !done.include?(it["id"]) && !ids.include?(it["id"]) }
    end

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
