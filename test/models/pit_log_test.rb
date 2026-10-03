require "test_helper"

class PitLogTest < ActiveSupport::TestCase
  setup { @race = Race.create!(name: "Этап 4", lanes: 2) }

  # A move written short: "a=1:5@12" is move a, team 5 into the second corridor, entered at 12;
  # "s=0:?@1" a spare kart put into the first.
  def move(written)
    id, lane, kart, at = written.match(/\A(.+)=(\d):(.+)@(\d+)\z/).captures
    { "id" => id, "lane" => lane.to_i, "kart" => kart == "?" ? nil : kart, "at" => at.to_i }
  end

  def log(moves, undone = [])
    @race.build_pit_log(moves: moves, undone: undone)
  end

  def with(**changes)
    move("a=0:5@1791028800000").merge(changes.transform_keys(&:to_s))
  end

  test "keeps spare karts and teams that came into corridors, each with its id and when it was entered" do
    assert log([ move("s0=0:?@1"), move("9f1c2d3e-4b5a-6789-0abc-def012345678=1:12A@1791028800000") ]).valid?
    # A move kept from before the moves had times: its place in the old log for one.
    assert log([ move("L0-0-S=0:?@0"), move("L1-0-5=0:5@1") ]).valid?
    assert log([]).valid?
  end

  test "keeps moves into a corridor the race no longer shows" do
    assert log([ move("a=2:5@1") ]).valid?
  end

  test "keeps the ids of the moves undone, even of moves it does not have yet" do
    assert log([ move("a=0:5@1") ], [ "a", "b" ]).valid?
    assert log([], [ "L3-0-7" ]).valid?
  end

  test "keeps a whole day of a big race" do
    moves = Array.new(PitLog::MOVES_LIMIT) { move("m#{it}=#{it % 2}:#{it % 60 + 1}@#{it}") }
    assert log(moves, moves.map { it["id"] }).valid?
    assert_not log(moves + [ move("x=0:7@1") ]).valid?
    assert_not log([], Array.new(PitLog::MOVES_LIMIT + 1) { "u#{it}" }).valid?
  end

  test "refuses a move no phone would send" do
    [
      with(lane: 3), with(lane: -1), with(lane: "0"), with(lane: 1.0), with(lane: nil),
      with(kart: "пять"), with(kart: 5), with(kart: "1234"), with(kart: "5\u0000"),
      with(id: ""), with(id: "a b"), with(id: "a" * 65), with(id: 7), with(id: nil), with(id: "a\u0000"),
      with(at: -1), with(at: 1.5), with(at: "10:00"), with(at: nil), with(at: PitLog::LAST_AT + 1),
      move("a=0:5@1").except("at"), move("a=0:5@1").except("kart"), with(by: "me"),
      "a=0:5@1", [ 0, "5" ], nil
    ].each do |move|
      assert_not log([ move ]).valid?, move.inspect
    end
    assert log([ with(at: PitLog::LAST_AT), with(id: "b" * 64, at: 0) ]).valid?
  end

  test "refuses a log that is not a list of moves, each once" do
    assert_not log("all of it").valid?
    assert_not log({ "a" => move("a=0:5@1") }).valid?
    assert_not log([ move("a=0:5@1"), move("a=1:9@2") ]).valid?
  end

  test "refuses undone ids no phone would send" do
    [ [ "a", "a" ], [ "a b" ], [ "" ], [ 7 ], [ nil ], [ "a\u0000" ], [ { "id" => "a" } ] ].each do |undone|
      assert_not log([], undone).valid?, undone.inspect
    end
    assert_not log([], "a").valid?
  end

  test "takes in the moves and undone ids it does not have yet, after the ones it has" do
    pits = log([ move("a=0:5@10"), move("b=0:9@12") ], [ "b" ])

    pits.take([ move("c=1:3@11"), move("a=0:5@10"), move("d=0:7@13") ], [ "b", "c" ])

    assert_equal [ move("a=0:5@10"), move("b=0:9@12"), move("c=1:3@11"), move("d=0:7@13") ], pits.moves
    assert_equal [ "b", "c" ], pits.undone
    assert pits.valid?
  end

  test "the same moves taken again change nothing" do
    pits = log([ move("a=0:5@10"), move("b=0:9@12") ], [ "a" ])
    pits.save!

    pits.take([ move("b=0:9@12"), move("a=0:5@10") ], [ "a" ])

    assert_not pits.changed?
  end

  test "a move undone on one phone stays undone, whatever another phone sends after" do
    pits = log([ move("a=0:5@10") ])
    pits.take([], [ "a" ])
    # The other phone has not read the undo: it sends the move again, as it had it.
    pits.take([ move("a=0:5@10") ], [])

    assert_equal [ [ move("a=0:5@10") ], [ "a" ] ], [ pits.moves, pits.undone ]
  end

  test "keeps the first copy of a move" do
    pits = log([ move("a=0:5@10") ])
    pits.take([ move("a=1:9@11"), move("b=0:7@12"), move("b=1:7@12") ], [])

    assert_equal [ move("a=0:5@10"), move("b=0:7@12") ], pits.moves
  end

  test "whatever is not a move is taken in, so the log is refused" do
    [ with(lane: 3), with(id: "a", by: "me"), 7 ].each do |sent|
      pits = log([ move("a=0:5@1791028800000") ])
      pits.take([ sent ], [])

      assert_not pits.valid?, sent.inspect
    end

    pits = log([])
    pits.take([], [ "a b" ])
    assert_not pits.valid?
  end
end
