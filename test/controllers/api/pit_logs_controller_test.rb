require "test_helper"

class Api::PitLogsControllerTest < ActionDispatch::IntegrationTest
  RACE = "5f0c8a52-3d47-4e8e-9b0a-6f1d2c3b4a59"
  MOVES = [ { "lane" => 0, "kart" => nil }, { "lane" => 0, "kart" => nil }, { "lane" => 0, "kart" => "13" } ].freeze

  setup do
    sign_in_as users(:one)
    Race.create!(id: RACE, name: "Этап 4 · Сочи", lanes: 2)
  end

  def put_log(race = RACE, **log)
    put api_race_pit_log_url(race), params: { pit_log: log }, as: :json
  end

  test "needs a session" do
    sign_out

    get api_race_pit_log_url(RACE)
    assert_response :unauthorized
    put_log(moves: MOVES, count: 3, version: 0)
    assert_response :unauthorized
  end

  test "a race with nothing done in its pits has an empty log" do
    get api_race_pit_log_url(RACE)

    assert_response :ok
    assert_equal({ "moves" => [], "count" => 0, "version" => 0 }, response.parsed_body)
  end

  test "the first log of a race is version 1" do
    put_log(moves: MOVES, count: 2, version: 0)

    assert_response :ok
    assert_equal({ "moves" => MOVES, "count" => 2, "version" => 1 }, response.parsed_body)
    get api_race_pit_log_url(RACE)
    assert_equal({ "moves" => MOVES, "count" => 2, "version" => 1 }, response.parsed_body)
  end

  test "a log made on the one here replaces it" do
    put_log(moves: MOVES, count: 3, version: 0)
    put_log(moves: MOVES.first(1), count: 0, version: 1)

    assert_response :ok
    assert_equal({ "moves" => MOVES.first(1), "count" => 0, "version" => 2 }, response.parsed_body)
    assert_equal [ MOVES.first(1), 0, 2 ], [ PitLog.sole.moves, PitLog.sole.count, PitLog.sole.version ]
  end

  test "the same log sent again changes nothing, whatever it was made on" do
    # The answer to the first send was lost: the phone sends the same log on the same version.
    2.times { put_log(moves: MOVES, count: 2, version: 0) }
    assert_response :ok
    assert_equal({ "moves" => MOVES, "count" => 2, "version" => 1 }, response.parsed_body)

    # Another phone made the same moves.
    assert_no_changes -> { PitLog.sole.updated_at } do
      put_log(moves: MOVES, count: 2)
    end
    assert_response :ok
    assert_equal({ "moves" => MOVES, "count" => 2, "version" => 1 }, response.parsed_body)
  end

  test "a log made on an older one gets the log here back and changes nothing" do
    PitLog.create!(race_id: RACE, moves: MOVES, count: 3, version: 3)

    assert_no_changes -> { PitLog.sole.attributes } do
      put_log(moves: MOVES + [ { "lane" => 1, "kart" => "7" } ], count: 4, version: 2)
    end

    assert_response :conflict
    assert_equal({ "moves" => MOVES, "count" => 3, "version" => 3 }, response.parsed_body)
  end

  test "a phone that never had the log here cannot write over it" do
    PitLog.create!(race_id: RACE, moves: MOVES, count: 3, version: 1)

    put_log(moves: [ { "lane" => 1, "kart" => "7" } ], count: 1, version: 0)

    assert_response :conflict
    assert_equal({ "moves" => MOVES, "count" => 3, "version" => 1 }, response.parsed_body)
    assert_equal MOVES, PitLog.sole.moves
  end

  test "a log with no version is not taken" do
    put_log(moves: MOVES, count: 3)

    assert_response :conflict
    assert_equal({ "moves" => [], "count" => 0, "version" => 0 }, response.parsed_body)
    assert_not PitLog.exists?
  end

  test "a version that is not a whole number is no version" do
    PitLog.create!(race_id: RACE, moves: MOVES, count: 3, version: 1)

    [ "1", 1.0, nil, [ 1 ] ].each do |version|
      put_log(moves: MOVES.first(1), count: 1, version: version)

      assert_response :conflict
      assert_equal({ "moves" => MOVES, "count" => 3, "version" => 1 }, response.parsed_body)
    end
    assert_equal [ MOVES, 1 ], [ PitLog.sole.moves, PitLog.sole.version ]
  end

  test "refuses a log that makes no sense" do
    put_log(moves: MOVES, count: 4, version: 0)

    assert_response :unprocessable_content
    assert_not PitLog.exists?
  end

  test "a log that makes no sense leaves the one here as it was" do
    PitLog.create!(race_id: RACE, moves: MOVES, count: 3, version: 2)

    assert_no_changes -> { PitLog.sole.attributes } do
      put_log(moves: MOVES + [ { "lane" => 3, "kart" => "7" } ], count: 4, version: 2)
    end

    assert_response :unprocessable_content
  end

  test "a send with no log in it is a bad request" do
    put api_race_pit_log_url(RACE), params: { pit_log: "all of it" }, as: :json

    assert_response :bad_request
    assert_not PitLog.exists?
  end

  test "a race the server does not have yet has no pits" do
    put_log("6a1d9b63-4e58-4f9f-8c1b-7a2e3d4c5b6a", moves: MOVES, count: 3, version: 0)

    assert_response :not_found
  end
end
