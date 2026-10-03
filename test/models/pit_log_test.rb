require "test_helper"

class PitLogTest < ActiveSupport::TestCase
  setup { @race = Race.create!(name: "Этап 4", lanes: 2) }

  def log(moves, count = moves.size, version: 0)
    @race.build_pit_log(moves: moves, count: count, version: version)
  end

  test "keeps spare karts and teams that came into corridors, and how many of them stand" do
    assert log([ { "lane" => 0, "kart" => nil }, { "lane" => 1, "kart" => "12A" } ], 1).valid?
    assert log([]).valid?
  end

  test "keeps when each move was entered, and moves with no time" do
    assert log([ { "lane" => 0, "kart" => "5", "at" => 1_791_028_800_000 }, { "lane" => 0, "kart" => "7" } ]).valid?
    assert_not log([ { "lane" => 0, "kart" => "5", "at" => -1 } ]).valid?
    assert_not log([ { "lane" => 0, "kart" => "5", "at" => 1.5 } ]).valid?
    assert_not log([ { "lane" => 0, "kart" => "5", "at" => "10:00" } ]).valid?
    assert_not log([ { "lane" => 0, "kart" => "5", "at" => 1, "by" => "me" } ]).valid?
  end

  test "keeps moves into a corridor the race no longer shows" do
    assert log([ { "lane" => 2, "kart" => "5" } ]).valid?
  end

  test "keeps a whole day of a big race" do
    assert log(Array.new(PitLog::MOVES_LIMIT) { { "lane" => it % 2, "kart" => (it % 60 + 1).to_s } }).valid?
    assert_not log(Array.new(PitLog::MOVES_LIMIT + 1) { { "lane" => 0, "kart" => "7" } }).valid?
  end

  test "refuses what no phone would send" do
    assert_not log([ { "lane" => 3, "kart" => "5" } ]).valid?
    assert_not log([ { "lane" => 0, "kart" => "пять" } ]).valid?
    assert_not log([ { "lane" => 0, "kart" => 5 } ]).valid?
    assert_not log([ { "lane" => 0 } ]).valid?
    assert_not log([ { "lane" => 0, "kart" => "5" } ], 2).valid?
    assert_not log([ { "lane" => 0, "kart" => "5" } ], -1).valid?
    assert_not log("all of it").valid?
  end

  test "a version is a whole number from 0" do
    assert log([], version: 12).valid?
    assert_not log([], version: -1).valid?
    assert_not log([], version: 1.5).valid?
    assert_not log([], version: "new").valid?
  end
end
