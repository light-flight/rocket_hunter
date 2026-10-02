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
end
