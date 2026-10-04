require "test_helper"

class RaceTest < ActiveSupport::TestCase
  test "squeezes spaces and control characters out of the name" do
    assert_equal "Этап 3 · Казань", Race.new(name: "  Этап 3  ·\tКазань ").name
    assert_equal "Этап 3", Race.new(name: "Этап\u00003").name
  end

  test "needs a name of up to 100 characters" do
    assert_not Race.new(name: "   ").valid?
    assert_not Race.new(name: "а" * 101).valid?
    assert Race.new(name: "а" * 100).valid?
  end

  test "has no corridors of its own: they are chosen in its pits" do
    assert_not Race.new.has_attribute?(:lanes)
  end

  test "karts are averaged across the protocols, fastest first, a lap seen twice counted once" do
    race = Race.create!(name: "Этап 4")
    read(race, "5" => [ 40_947 ], "11" => [ 41_294 ])
    read(race, "5" => [ 40_947, 41_053 ], "11" => [ 41_300 ])

    assert_equal [ { kart: "5", average: 41_000, laps: 2, pace: 0.0 }, { kart: "11", average: 41_297, laps: 2, pace: 1.0 } ],
      race.karts
  end

  test "the pace follows the time: karts close together stay close, one far behind stands apart" do
    race = Race.create!(name: "Этап 4")
    read(race, { "1" => 41_000, "2" => 42_000, "3" => 43_000, "4" => 44_000, "5" => 45_000, "6" => 70_000 }.transform_values { [ it ] })

    assert_equal [ 0.0, 0.034, 0.069, 0.103, 0.138, 1.0 ], race.karts.pluck(:pace)
  end

  test "one kart, or all as fast as each other, are all the fastest" do
    race = Race.create!(name: "Этап 4")
    assert_empty race.karts

    read(race, "7" => [ 41_000 ], "8" => [ 41_000 ])
    assert_equal [ 0.0, 0.0 ], race.karts.pluck(:pace)
  end

  test "only protocols that were read count" do
    race = Race.create!(name: "Этап 4")
    read(race, "7" => [ 41_000 ])
    race.qualification_files.create!(name: "Квала 10.pdf", data: "%PDF-1.4 10".b, laps: { "8" => [ 40_000 ] })

    assert_equal [ "7" ], race.karts.pluck(:kart)
  end

  private
    def read(race, laps)
      race.qualification_files.create!(name: "Квала.pdf", data: "%PDF-1.4 #{laps}".b).update!(status: :read, laps: laps)
    end
end
