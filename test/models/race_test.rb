require "test_helper"

class RaceTest < ActiveSupport::TestCase
  test "squeezes the spaces out of the name" do
    assert_equal "Этап 3 · Казань", Race.new(name: "  Этап 3  ·\tКазань ").name
  end

  test "needs a name of up to 100 characters" do
    assert_not Race.new(name: "   ").valid?
    assert_not Race.new(name: "а" * 101).valid?
    assert Race.new(name: "а" * 100).valid?
  end
end
