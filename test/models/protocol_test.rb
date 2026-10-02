require "test_helper"

class ProtocolTest < ActiveSupport::TestCase
  test "reads lap times as they are printed" do
    assert_equal 40_947, Protocol.milliseconds("40.947")
    assert_equal 62_345, Protocol.milliseconds("1:02.345")
    assert_equal 62_345, Protocol.milliseconds("01:02.345")
    assert_equal 62_345, Protocol.milliseconds("1.02.345")
    assert_equal 62_300, Protocol.milliseconds("1:02,3")
    assert_equal 62_345, Protocol.milliseconds(" 00:01:02.345 ")
    assert_equal 62_345, Protocol.milliseconds("62.345")
  end

  test "is not fooled by what is not a lap time" do
    assert_nil Protocol.milliseconds("14")
    assert_nil Protocol.milliseconds("1:72.345")
    assert_nil Protocol.milliseconds("DNF")
    assert_nil Protocol.milliseconds(nil)
  end

  test "reads kart numbers the way the team writes them" do
    assert_equal "7", Protocol.kart("07")
    assert_equal "7", Protocol.kart("№ 7")
    assert_equal "12A", Protocol.kart("12а")
    assert_equal "0", Protocol.kart("0")
    assert_nil Protocol.kart("Тюменцев")
    assert_nil Protocol.kart("")
  end

  test "gathers each kart's best laps, and the same row twice counts once" do
    protocol = Protocol.new([
      { "kart" => "5", "best_lap" => "40.947" },
      { "kart" => "05", "best_lap" => "41.256" },
      { "kart" => "11", "best_lap" => "41.294" },
      { "kart" => "11", "best_lap" => "41.294" }
    ])

    assert_equal({ "5" => [ 40_947, 41_256 ], "11" => [ 41_294 ] }, protocol.laps)
    assert_empty protocol.warnings
  end

  test "two times are kept as they are: neither is the middle" do
    protocol = Protocol.new([ { "kart" => "5", "best_lap" => "40.947" }, { "kart" => "11", "best_lap" => "1:04.180" } ])

    assert_equal({ "5" => [ 40_947 ], "11" => [ 64_180 ] }, protocol.laps)
  end

  test "leaves out what cannot be a best lap of this protocol and says so" do
    protocol = Protocol.new([
      { "kart" => "5", "best_lap" => "40.947" },
      { "kart" => "11", "best_lap" => "41.294" },
      { "kart" => "10", "best_lap" => "41.306" },
      { "kart" => "3", "best_lap" => "52.106" },
      { "kart" => "6", "best_lap" => "11:51.509" },
      { "kart" => "16", "best_lap" => "14" },
      { "kart" => "Тюменцев", "best_lap" => "41.347" }
    ])

    assert_equal %w[ 5 11 10 ], protocol.laps.keys
    assert_equal [ "Карт 6: «11:51.509» не похоже на время круга — не учтено",
      "Карт 16: «14» не похоже на время круга — не учтено",
      "Не понятен номер карта «Тюменцев» — время не учтено",
      "Карт 3: 52.106 слишком далеко от остальных — не учтено" ], protocol.warnings
  end
end
