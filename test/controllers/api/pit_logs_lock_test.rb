require "test_helper"

# Phones send at the same moment. The log of a race takes them in one at a time, so nothing any of
# them sent is lost. That needs real transactions and real locks, not the test's own transaction.
class Api::PitLogsLockTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  RACE = "7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f"
  AT = 1_791_028_800_000
  PHONES = 4

  setup do
    sign_in_as users(:one)
    Race.create!(id: RACE, name: "Этап 7 · Казань", lanes: 2)
    # Loads the controller and the models before the phones start at once.
    get api_race_pit_log_url(RACE)
  end

  teardown do
    Race.where(id: RACE).destroy_all
    users(:one).sessions.delete_all
  end

  test "phones that send at once each have all they sent taken in" do
    # The first round makes the log, the second adds to it.
    2.times do |round|
      phones = Array.new(PHONES) do |phone|
        Thread.new do
          status = nil
          open_session do |other|
            other.cookies["session_id"] = cookies["session_id"]
            moves = Array.new(5) { { id: "r#{round}-p#{phone}-m#{it}", lane: phone % 2, kart: (phone + 1).to_s, at: AT + it } }
            other.put api_race_pit_log_url(RACE), params: { pit_log: { moves: moves, undone: [ "r#{round}-p#{phone}-m0" ] } },
              as: :json
            status = other.response.status
          end
          status
        end
      end
      assert_equal [ 204 ] * PHONES, phones.map(&:value)
    end

    # Past the query cache, which still has the empty race of the first read.
    log = PitLog.uncached { PitLog.find_by!(race_id: RACE) }
    assert_equal 2 * PHONES * 5, log.moves.map { it["id"] }.uniq.size
    assert_equal 2 * PHONES * 5, log.moves.size
    assert_equal 2 * PHONES, log.undone.size
  end
end
