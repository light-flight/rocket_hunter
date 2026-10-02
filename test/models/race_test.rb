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

  test "has one corridor unless told otherwise, and never more than three" do
    assert_equal 1, Race.new.lanes
    assert_not Race.new(name: "Этап 1", lanes: 0).valid?
    assert_not Race.new(name: "Этап 1", lanes: 4).valid?
    assert Race.new(name: "Этап 1", lanes: 3).valid?
  end
end
