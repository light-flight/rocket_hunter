require "test_helper"

class Api::SignInAttemptsControllerTest < ActionDispatch::IntegrationTest
  test "create starts an attempt and answers with a link to the bot" do
    assert_difference "SignInAttempt.active.count", 1 do
      post api_sign_in_attempt_url, headers: { "User-Agent" => "Mozilla/5.0 (Linux; Android 16)" }
    end

    assert_response :created
    attempt = SignInAttempt.order(:created_at).last
    assert_nil attempt.user
    assert_equal "Android", attempt.device
    assert_equal "https://t.me/#{Rails.configuration.x.telegram.bot_username}?start=#{attempt.token}",
      response.parsed_body["telegram_url"]
    assert_equal 300, response.parsed_body["expires_in"]
    assert_match(/^sign_in_attempt_id=[^\n]*httponly/i, Array(response.headers["Set-Cookie"]).join("\n"))
  end

  test "create purges expired attempts" do
    expired, pending = sign_in_attempts(:expired, :pending)

    post api_sign_in_attempt_url

    assert_not SignInAttempt.exists?(expired.id)
    assert SignInAttempt.exists?(pending.id)
  end

  test "create from another site is forbidden" do
    assert_no_difference "SignInAttempt.count" do
      post api_sign_in_attempt_url, headers: { "Sec-Fetch-Site" => "cross-site" }
    end

    assert_response :forbidden
  end
end
