require "test_helper"

class Api::RacesControllerTest < ActionDispatch::IntegrationTest
  ID = "5f0c8a52-3d47-4e8e-9b0a-6f1d2c3b4a59"

  setup { sign_in_as users(:one) }

  test "index and update need a session" do
    sign_out

    get api_races_url
    assert_response :unauthorized

    assert_no_difference "Race.count" do
      put api_race_url(ID), params: { race: { name: "Этап 1" } }, as: :json
    end
    assert_response :unauthorized
  end

  test "index lists the races of the whole team, newest first" do
    Race.create!(id: ID, name: "Этап 1", created_at: 2.weeks.ago)
    newer = Race.create!(name: "Этап 2", created_at: 1.week.ago)

    get api_races_url

    assert_response :ok
    assert_equal [ newer.id, ID ], response.parsed_body["races"].pluck("id")
    assert_equal({ "id" => ID, "name" => "Этап 1", "created_at" => Race.find(ID).created_at.iso8601(3) },
      response.parsed_body["races"].last)
  end

  test "update creates the race under the id the phone made" do
    assert_difference "Race.count", 1 do
      put api_race_url(ID), params: { race: { name: " Этап 1 · Крылатское " } }, as: :json
    end

    assert_response :created
    assert_equal "Этап 1 · Крылатское", Race.find(ID).name
    assert_equal({ "id" => ID, "name" => "Этап 1 · Крылатское", "created_at" => Race.find(ID).created_at.iso8601(3) },
      response.parsed_body)
  end

  test "the same race sent again is not a second race" do
    2.times { put api_race_url(ID), params: { race: { name: "Этап 1" } }, as: :json }

    assert_response :ok
    assert_equal 1, Race.where(id: ID).count
  end

  test "update renames a race" do
    Race.create!(id: ID, name: "Этап 1", created_at: 1.week.ago)

    assert_no_changes -> { Race.find(ID).created_at } do
      put api_race_url(ID), params: { race: { name: "Этап 1 · Москва", created_at: Time.current } }, as: :json
    end

    assert_response :ok
    assert_equal "Этап 1 · Москва", Race.find(ID).name
  end

  test "the corridors a phone from before the pits chose them still sends with a race are left out" do
    put api_race_url(ID), params: { race: { name: "Этап 1", lanes: 2 } }, as: :json
    assert_response :created
    assert_not response.parsed_body.key?("lanes")

    PitLog.create!(race_id: ID, lanes: 3, lanes_at: 1_791_028_800_000)
    [ 1, 4, "два", nil ].each do |lanes|
      put api_race_url(ID), params: { race: { name: "Этап 1 · Москва", lanes: lanes } }, as: :json

      assert_response :ok
      assert_equal "Этап 1 · Москва", Race.find(ID).name
    end
    assert_equal [ 3, 1_791_028_800_000 ], PitLog.sole.values_at(:lanes, :lanes_at)
  end

  test "a race keeps the time it was made on the phone, but never a time ahead of the server" do
    made = 2.days.ago.round(3)
    put api_race_url(ID), params: { race: { name: "Этап 1", created_at: made.iso8601(3) } }, as: :json
    assert_equal made, Race.find(ID).created_at

    other = "6a1d9b63-4e58-4f9f-8c1b-7a2e3d4c5b6a"
    freeze_time do
      put api_race_url(other), params: { race: { name: "Этап 2", created_at: 1.day.from_now.iso8601 } }, as: :json
      assert_equal Time.current, Race.find(other).created_at
    end

    put api_race_url("7b2e0c74-5f69-4a0a-9d2c-8b3f4e5d6c7b"), params: { race: { name: "Этап 3", created_at: "вчера" } },
      as: :json
    assert_response :created
  end

  test "update refuses a race without a name" do
    assert_no_difference "Race.count" do
      put api_race_url(ID), params: { race: { name: "  " } }, as: :json
    end
    assert_response :unprocessable_content

    put api_race_url(ID), params: {}, as: :json
    assert_response :bad_request
  end

  test "an id that is not a UUID is not a race" do
    put "/api/races/1", params: { race: { name: "Этап 1" } }, as: :json

    assert_response :not_found
  end

  test "update refuses a request from another site" do
    assert_no_difference "Race.count" do
      put api_race_url(ID), params: { race: { name: "Этап 1" } }, as: :json,
        headers: { "Sec-Fetch-Site" => "cross-site" }
    end

    assert_response :forbidden
  end
end
