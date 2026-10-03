require "test_helper"

class PitLogTest < ActiveSupport::TestCase
  setup { @race = Race.create!(name: "Этап 4", lanes: 2) }

  def log(moves, count = moves.size)
    @race.build_pit_log(moves: moves, count: count)
  end

  test "keeps unknown karts and karts dropped into corridors, and how many of them stand" do
    assert log([ { "lane" => 0, "kart" => nil }, { "lane" => 1, "kart" => "12A" } ], 1).valid?
    assert log([]).valid?
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
end
