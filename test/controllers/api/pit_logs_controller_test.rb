require "test_helper"

class Api::PitLogsControllerTest < ActionDispatch::IntegrationTest
  RACE = "5f0c8a52-3d47-4e8e-9b0a-6f1d2c3b4a59"
  MOVES = [ { "lane" => 0, "kart" => nil }, { "lane" => 0, "kart" => nil }, { "lane" => 0, "kart" => "13" } ].freeze

  setup do
    sign_in_as users(:one)
    Race.create!(id: RACE, name: "Этап 4 · Сочи", lanes: 2)
  end

  test "needs a session" do
    sign_out

    get api_race_pit_log_url(RACE)
    assert_response :unauthorized
    put api_race_pit_log_url(RACE), params: { pit_log: { moves: MOVES, count: 3 } }, as: :json
    assert_response :unauthorized
  end

  test "a race with nothing done in its pits has an empty log" do
    get api_race_pit_log_url(RACE)

    assert_response :ok
    assert_equal({ "moves" => [], "count" => 0 }, response.parsed_body)
  end

  test "takes the whole log, and the same log sent again changes nothing" do
    2.times { put api_race_pit_log_url(RACE), params: { pit_log: { moves: MOVES, count: 2 } }, as: :json }

    assert_response :ok
    assert_equal 1, PitLog.count
    get api_race_pit_log_url(RACE)
    assert_equal({ "moves" => MOVES, "count" => 2 }, response.parsed_body)
  end

  test "a newer log replaces the old one" do
    put api_race_pit_log_url(RACE), params: { pit_log: { moves: MOVES, count: 3 } }, as: :json
    put api_race_pit_log_url(RACE), params: { pit_log: { moves: MOVES.first(1), count: 0 } }, as: :json

    assert_equal [ MOVES.first(1), 0 ], [ PitLog.sole.moves, PitLog.sole.count ]
  end

  test "refuses a log that makes no sense" do
    put api_race_pit_log_url(RACE), params: { pit_log: { moves: MOVES, count: 4 } }, as: :json

    assert_response :unprocessable_content
    assert_not PitLog.exists?
  end

  test "a race the server does not have yet has no pits" do
    put api_race_pit_log_url("6a1d9b63-4e58-4f9f-8c1b-7a2e3d4c5b6a"), params: { pit_log: { moves: MOVES, count: 3 } }, as: :json

    assert_response :not_found
  end
end
