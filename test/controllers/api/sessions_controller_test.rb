require "test_helper"

class Api::SessionsControllerTest < ActionDispatch::IntegrationTest
  setup { @user = users(:one) }

  test "create without an attempt answers gone" do
    post api_session_url

    assert_response :gone
  end

  test "create answers accepted while the attempt is not confirmed" do
    start_attempt

    assert_no_difference "Session.count" do
      post api_session_url
    end

    assert_response :accepted
    assert_empty response.body
  end

  test "create signs in once the attempt is confirmed" do
    attempt = start_attempt
    attempt.update!(user: @user)

    assert_difference -> { @user.sessions.count }, 1 do
      post api_session_url
    end

    assert_response :created
    assert_equal({ "user" => { "name" => "Иван Петров", "avatar" => nil } }, response.parsed_body)
    assert_not SignInAttempt.exists?(attempt.id)
    assert_match(/^session_id=[^\n]*httponly/i, Array(response.headers["Set-Cookie"]).join("\n"))

    get api_session_url
    assert_response :ok
  end

  test "create answers gone after the attempt was used" do
    start_attempt.update!(user: @user)
    post api_session_url

    assert_no_difference "Session.count" do
      post api_session_url
    end

    assert_response :gone
  end

  test "create answers gone for an expired attempt" do
    start_attempt.update!(user: @user, created_at: 6.minutes.ago)

    assert_no_difference "Session.count" do
      post api_session_url
    end

    assert_response :gone
  end

  test "create from another site is forbidden" do
    post api_session_url, headers: { "Sec-Fetch-Site" => "cross-site" }

    assert_response :forbidden
  end

  test "create with a foreign Origin and no Sec-Fetch-Site is forbidden" do
    post api_session_url, headers: { "Origin" => "https://evil.example" }

    assert_response :forbidden
  end

  test "create with its own Origin and no Sec-Fetch-Site passes the origin check" do
    post api_session_url, headers: { "Origin" => "http://www.example.com" }

    assert_response :gone
  end

  test "show without a session answers unauthorized" do
    get api_session_url

    assert_response :unauthorized
    assert_empty response.body
  end

  test "show answers with the manager's name" do
    sign_in_as @user

    get api_session_url

    assert_response :ok
    assert_equal({ "user" => { "name" => "Иван Петров", "avatar" => nil } }, response.parsed_body)
  end

  test "show gives the address of the manager's photo, which changes with the photo" do
    sign_in_as @user
    Avatar.create!(user: @user, telegram_file_id: "a", data: "\xFF\xD8\xFFone".b, checksum: "0123456789abcdef0123")

    get api_session_url

    assert_equal "/api/avatar?v=0123456789abcdef", response.parsed_body.dig("user", "avatar")
  end

  test "show answers unauthorized after the session is destroyed on the server" do
    sign_in_as @user
    @user.sessions.destroy_all

    get api_session_url

    assert_response :unauthorized
  end

  test "destroy signs out" do
    sign_in_as @user

    assert_difference "Session.count", -1 do
      delete api_session_url
    end
    assert_response :no_content

    get api_session_url
    assert_response :unauthorized
  end

  private
    # The attempt is identified only by the cookie that starting it sets.
    def start_attempt
      post api_sign_in_attempt_url
      SignInAttempt.order(:created_at).last
    end
end
