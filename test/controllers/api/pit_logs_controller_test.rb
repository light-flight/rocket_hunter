require "test_helper"

class Api::PitLogsControllerTest < ActionDispatch::IntegrationTest
  RACE = "5f0c8a52-3d47-4e8e-9b0a-6f1d2c3b4a59"
  AT = 1_791_028_800_000
  SPARES = [ { "id" => "s0", "lane" => 0, "kart" => nil, "at" => AT }, { "id" => "s1", "lane" => 0, "kart" => nil, "at" => AT } ].freeze

  setup do
    sign_in_as users(:one)
    Race.create!(id: RACE, name: "Этап 4 · Сочи", lanes: 2)
  end

  # Team 13 into the first corridor, a minute in.
  def stop(id, kart = "13", lane: 0, at: AT + 60_000)
    { "id" => id, "lane" => lane, "kart" => kart, "at" => at }
  end

  def put_log(race = RACE, **log)
    put api_race_pit_log_url(race), params: { pit_log: log }, as: :json
  end

  def get_log(**read)
    get api_race_pit_log_url(RACE), params: read
    response.parsed_body
  end

  def stored
    log = PitLog.sole
    [ log.moves, log.undone ]
  end

  test "needs a session" do
    sign_out

    get api_race_pit_log_url(RACE)
    assert_response :unauthorized
    put_log(moves: SPARES)
    assert_response :unauthorized
    assert_not PitLog.exists?
  end

  test "a race with nothing done in its pits has an empty log" do
    assert_equal({ "moves" => [], "undone" => [], "from" => { "moves" => 0, "undone" => 0 }, "total" => { "moves" => 0, "undone" => 0 } },
      get_log)
    assert_response :ok
    assert_equal({ "moves" => [], "undone" => [], "from" => { "moves" => 0, "undone" => 0 }, "total" => { "moves" => 0, "undone" => 0 } },
      get_log(moves: 3, undone: 1))
  end

  test "takes the moves and undos a phone sends, and gives them back" do
    put_log(moves: SPARES + [ stop("a") ], undone: [ "s1" ])

    assert_response :no_content
    assert_equal [ SPARES + [ stop("a") ], [ "s1" ] ], stored
    assert_equal({ "moves" => SPARES + [ stop("a") ], "undone" => [ "s1" ], "from" => { "moves" => 0, "undone" => 0 },
      "total" => { "moves" => 3, "undone" => 1 } }, get_log)
  end

  test "puts together what two phones send" do
    put_log(moves: SPARES + [ stop("a", "1") ])
    # The other phone had the spares from the first, entered team 5 and undid a spare.
    put_log(moves: SPARES + [ stop("b", "5", at: AT + 30_000) ], undone: [ "s1" ])
    put_log(undone: [ "a" ])

    assert_response :no_content
    assert_equal [ SPARES + [ stop("a", "1"), stop("b", "5", at: AT + 30_000) ], [ "s1", "a" ] ], stored
  end

  test "the same moves sent again change nothing" do
    put_log(moves: SPARES + [ stop("a") ], undone: [ "s0" ])

    # The answer was lost, or the phone sent them before it heard back.
    assert_no_changes -> { PitLog.sole.attributes } do
      put_log(moves: [ stop("a") ] + SPARES, undone: [ "s0" ])
    end
    assert_response :no_content
  end

  test "an undo sent by one phone holds when another sends the move after it" do
    put_log(moves: SPARES + [ stop("a") ])
    put_log(undone: [ "a" ])
    # The other phone has not read the undo yet and sends what it has.
    put_log(moves: SPARES + [ stop("a") ])

    assert_response :no_content
    assert_equal [ SPARES + [ stop("a") ], [ "a" ] ], stored
    assert_equal [ "a" ], get_log["undone"]
  end

  test "an undo may come before the move it undoes" do
    put_log(undone: [ "a" ])
    put_log(moves: [ stop("a") ])

    assert_equal [ [ stop("a") ], [ "a" ] ], stored
  end

  test "a move sent again keeps the first copy" do
    put_log(moves: [ stop("a") ])
    put_log(moves: [ stop("a", "7", lane: 1), stop("b", "5"), stop("b", "9") ], undone: [ "b", "b" ])

    assert_response :no_content
    assert_equal [ [ stop("a"), stop("b", "5") ], [ "b" ] ], stored
  end

  test "a send with nothing in it changes nothing" do
    put_log(moves: SPARES)

    assert_no_changes -> { PitLog.sole.attributes } do
      put_log
      put_log(moves: [], undone: [])
    end
    assert_response :no_content
  end

  test "a phone gets only what it has not read yet" do
    PitLog.create!(race_id: RACE, moves: SPARES + [ stop("a"), stop("b", "5") ], undone: [ "s1", "a" ])

    assert_equal({ "moves" => [ stop("b", "5") ], "undone" => [ "a" ], "from" => { "moves" => 3, "undone" => 1 },
      "total" => { "moves" => 4, "undone" => 2 } }, get_log(moves: 3, moves_last: "a", undone: 1, undone_last: "s1"))
    assert_equal({ "moves" => [], "undone" => [], "from" => { "moves" => 4, "undone" => 2 },
      "total" => { "moves" => 4, "undone" => 2 } }, get_log(moves: 4, moves_last: "b", undone: 2, undone_last: "a"))
    assert_equal({ "moves" => SPARES + [ stop("a"), stop("b", "5") ], "undone" => [], "from" => { "moves" => 0, "undone" => 2 },
      "total" => { "moves" => 4, "undone" => 2 } }, get_log(undone: 2, undone_last: "a"))
  end

  test "a list restored from a copy is sent whole, even grown back past what the phone read" do
    log = PitLog.create!(race_id: RACE, moves: SPARES + [ stop("a"), stop("b", "5") ], undone: [ "s1", "a" ])
    read = { moves: 4, moves_last: "b", undone: 2, undone_last: "a" }
    assert_equal({ "moves" => 4, "undone" => 2 }, get_log(**read)["from"])

    # Restored to the spares, then other phones sent two moves and an undo meanwhile.
    log.update!(moves: SPARES + [ stop("c", "7"), stop("d", "9") ], undone: [ "s1", "c" ])
    body = get_log(**read)

    assert_equal({ "moves" => 0, "undone" => 0 }, body["from"])
    assert_equal [ SPARES + [ stop("c", "7"), stop("d", "9") ], [ "s1", "c" ] ], [ body["moves"], body["undone"] ]
    # A phone that names no last one read gets the list whole too.
    assert_equal({ "moves" => 0, "undone" => 0 }, get_log(moves: 4, undone: 2)["from"])
  end

  test "a list is sent whole when the phone says nothing that makes sense of it" do
    PitLog.create!(race_id: RACE, moves: SPARES + [ stop("a") ], undone: [ "s1" ])

    # Beyond the list: the log here lost what the phone read, and the phone tells from the whole one.
    [ "", "x", "-1", "1.5", " 1", "1e1", "4", "99999999999999999999999" ].each do |read|
      body = get_log(moves: read, undone: read)

      assert_equal [ SPARES + [ stop("a") ], [ "s1" ] ], [ body["moves"], body["undone"] ], read.inspect
      assert_equal({ "moves" => 0, "undone" => 0 }, body["from"], read.inspect)
    end
    get api_race_pit_log_url(RACE), params: { moves: [ 1 ], undone: { "a" => 1 } }
    assert_equal({ "moves" => 0, "undone" => 0 }, response.parsed_body["from"])
  end

  test "refuses a send that makes no sense, and keeps nothing of it" do
    [
      { moves: "all of it" }, { moves: { "a" => stop("a") } }, { undone: "a" }, { undone: { "a" => 1 } },
      { moves: [ 7 ] }, { moves: [ [ 0, "13" ] ] }, { moves: [ "a=0:13" ] },
      { moves: [ stop("a b") ] }, { moves: [ stop("") ] }, { moves: [ stop("a" * 65) ] }, { moves: [ stop(7) ] },
      { moves: [ stop("a", lane: 3) ] }, { moves: [ stop("a", lane: "0") ] }, { moves: [ stop("a", "пять") ] },
      { moves: [ stop("a", 13) ] }, { moves: [ stop("a", [ "13" ]) ] }, { moves: [ stop("a", "13\u0000") ] },
      { moves: [ stop("a", at: -1) ] }, { moves: [ stop("a", at: 1.5) ] }, { moves: [ stop("a", at: "now") ] },
      { moves: [ stop("a").except("at") ] }, { moves: [ stop("a").merge("by" => "me") ] },
      { moves: [ stop("a").merge("by\u0000" => "me") ] },
      { undone: [ "a b" ] }, { undone: [ 7 ] }, { undone: [ "a\u0000" ] }, { undone: [ { "id" => "a" } ] }
    ].each do |log|
      put_log(**log)

      assert_response :unprocessable_content, log.inspect
    end
    assert_not PitLog.exists?
  end

  test "a send that makes no sense leaves the log here as it was" do
    PitLog.create!(race_id: RACE, moves: SPARES, undone: [ "s1" ])

    assert_no_changes -> { PitLog.sole.attributes } do
      # A good move with a bad one, and a spoiled copy of a move already here.
      put_log(moves: [ stop("a"), stop("b", lane: 3) ], undone: [ "s0" ])
      assert_response :unprocessable_content
      put_log(moves: [ SPARES.first.merge("lane" => 7) ])
      assert_response :unprocessable_content
    end
  end

  test "takes a whole day of a big race, and no more" do
    PitLog.create!(race_id: RACE, moves: Array.new(PitLog::MOVES_LIMIT - 1) { stop("m#{it}", (it % 60 + 1).to_s, at: AT + it) })

    put_log(moves: [ stop("last") ])
    assert_response :no_content
    assert_equal PitLog::MOVES_LIMIT, PitLog.sole.moves.size

    put_log(moves: [ stop("one-more") ])
    assert_response :unprocessable_content
    assert_equal PitLog::MOVES_LIMIT, PitLog.sole.moves.size
  end

  test "a send with no log in it is refused" do
    put api_race_pit_log_url(RACE), params: { pit_log: "all of it" }, as: :json
    assert_response :unprocessable_content
    put api_race_pit_log_url(RACE), params: { pit_log: [ stop("a") ] }, as: :json
    assert_response :unprocessable_content
    # Not JSON, so nothing is taken for a log.
    put api_race_pit_log_url(RACE), params: { moves: "all of it" }
    assert_response :bad_request

    assert_not PitLog.exists?
  end

  test "a race the server does not have yet has no pits" do
    put_log("6a1d9b63-4e58-4f9f-8c1b-7a2e3d4c5b6a", moves: SPARES)
    assert_response :not_found

    get api_race_pit_log_url("6a1d9b63-4e58-4f9f-8c1b-7a2e3d4c5b6a")
    assert_response :not_found
    assert_not PitLog.exists?
  end
end
