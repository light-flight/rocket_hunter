require "test_helper"

class Telegram::WebhooksControllerTest < ActionDispatch::IntegrationTest
  MANAGER = { id: 1001, first_name: "Иван", last_name: "Петров", username: "ivan_petrov" }
  STRANGER = { id: 2001, first_name: "Пётр", last_name: "Новиков", username: "novikov" }

  setup do
    @manager = users(:one)
    @attempt = sign_in_attempts(:pending)
  end

  test "refuses an update without the secret" do
    deliver message_update("/start", from: MANAGER), secret: nil

    assert_response :forbidden
  end

  test "refuses an update with a wrong secret" do
    deliver message_update("/start", from: MANAGER), secret: "wrong"

    assert_response :forbidden
  end

  test "refuses everything while no secret is configured" do
    configured = Rails.configuration.x.telegram.webhook_secret
    Rails.configuration.x.telegram.webhook_secret = ""

    deliver message_update("/start", from: MANAGER), secret: ""

    assert_response :forbidden
  ensure
    Rails.configuration.x.telegram.webhook_secret = configured
  end

  test "asks a manager who opened a sign-in link to confirm" do
    deliver message_update("/start #{@attempt.token}", from: MANAGER)

    assert_response :ok
    assert_equal "sendMessage", reply["method"]
    assert_equal MANAGER[:id], reply["chat_id"]
    assert_match(/Устройство: iPhone\. Запрошен \d+ с назад\./, reply["text"])
    assert_equal [ [
      { "text" => "Войти", "callback_data" => "confirm:#{@attempt.token}" },
      { "text" => "Это не я", "callback_data" => "reject:#{@attempt.token}" }
    ] ], reply.dig("reply_markup", "inline_keyboard")
    assert_nil @attempt.reload.user
  end

  test "refuses a stranger who opened a sign-in link" do
    deliver message_update("/start #{@attempt.token}", from: STRANGER)

    assert_equal Telegram::WebhooksController::REFUSAL, reply["text"]
    assert_nil reply["reply_markup"]
    assert_nil @attempt.reload.user
  end

  test "confirm from a manager hands the attempt to him" do
    deliver callback_update("confirm:#{@attempt.token}", from: MANAGER)

    assert_response :ok
    assert_equal({
      "method" => "answerCallbackQuery", "callback_query_id" => "77",
      "text" => Telegram::WebhooksController::CONFIRMED, "show_alert" => true
    }, reply)
    assert_equal @manager, @attempt.reload.user
  end

  test "a repeated confirm from the same manager gets the same answer" do
    2.times { deliver callback_update("confirm:#{@attempt.token}", from: MANAGER) }

    assert_equal Telegram::WebhooksController::CONFIRMED, reply["text"]
    assert_equal @manager, @attempt.reload.user
  end

  test "confirm for an attempt another manager confirmed changes nothing" do
    confirmed = sign_in_attempts(:confirmed)

    deliver callback_update("confirm:#{confirmed.token}", from: { id: 1002, first_name: "Мария" })

    assert_equal Telegram::WebhooksController::STALE, reply["text"]
    assert_equal @manager, confirmed.reload.user
  end

  test "confirm from a stranger changes nothing" do
    deliver callback_update("confirm:#{@attempt.token}", from: STRANGER)

    assert_equal Telegram::WebhooksController::STALE, reply["text"]
    assert_nil @attempt.reload.user
  end

  test "confirm for an expired attempt changes nothing" do
    expired = sign_in_attempts(:expired)

    deliver callback_update("confirm:#{expired.token}", from: MANAGER)

    assert_equal Telegram::WebhooksController::STALE, reply["text"]
    assert_nil expired.reload.user
  end

  test "confirm for an unknown token answers that the request is stale" do
    deliver callback_update("confirm:unknown", from: MANAGER)

    assert_equal "answerCallbackQuery", reply["method"]
    assert_equal Telegram::WebhooksController::STALE, reply["text"]
  end

  test "reject from a manager destroys the attempt" do
    deliver callback_update("reject:#{@attempt.token}", from: MANAGER)

    assert_equal Telegram::WebhooksController::REJECTED, reply["text"]
    assert_not SignInAttempt.exists?(@attempt.id)
  end

  test "lets in a stranger with a valid invitation" do
    invitation = invitations(:pending)

    assert_difference "User.count", 1 do
      deliver message_update("/start #{invitation.token}", from: STRANGER)
    end

    assert_equal Telegram::WebhooksController::WELCOME, reply["text"]
    user = User.find_by!(telegram_id: STRANGER[:id])
    assert_equal "Пётр Новиков", user.name
    assert_equal "novikov", user.username
    assert_equal @manager, user.invited_by
    assert_not Invitation.exists?(invitation.id)
  end

  test "refuses a stranger with an expired invitation" do
    assert_no_difference "User.count" do
      deliver message_update("/start #{invitations(:expired).token}", from: STRANGER)
    end

    assert_equal Telegram::WebhooksController::REFUSAL, reply["text"]
  end

  test "keeps an invitation opened by someone who is already a manager" do
    invitation = invitations(:pending)

    assert_no_difference "User.count" do
      deliver message_update("/start #{invitation.token}", from: MANAGER)
    end

    assert_equal Telegram::WebhooksController::HELP, reply["text"]
    assert Invitation.exists?(invitation.id)
  end

  test "a stranger's message writes nothing" do
    assert_no_difference [ "User.count", "Invitation.count", "Session.count", "SignInAttempt.count" ] do
      deliver message_update("Привет", from: STRANGER)
    end

    assert_response :ok
    assert_equal Telegram::WebhooksController::REFUSAL, reply["text"]
  end

  test "answers a start payload that cannot be a token" do
    deliver message_update("/start a\u0000b", from: STRANGER)

    assert_response :ok
    assert_equal Telegram::WebhooksController::REFUSAL, reply["text"]
  end

  test "tells a manager how to sign in" do
    deliver message_update("Привет", from: MANAGER)

    assert_equal Telegram::WebhooksController::HELP, reply["text"]
  end

  test "creates the manager with a fallback name when Telegram gives a blank one" do
    deliver message_update("/start #{invitations(:pending).token}", from: { id: 2002, first_name: " " })

    assert_response :ok
    assert_equal "Менеджер", User.find_by!(telegram_id: 2002).name
  end

  test "ignores a message in a group chat" do
    assert_no_difference "User.count" do
      deliver message_update("/start #{invitations(:pending).token}", from: STRANGER, chat_type: "group")
    end

    assert_response :ok
    assert_empty response.body
  end

  test "ignores an update without a message" do
    deliver({ update_id: 3, edited_message: message_update("/start", from: MANAGER)[:message] })

    assert_response :ok
    assert_empty response.body
  end

  test "ignores a message without text" do
    update = message_update("/start", from: MANAGER)
    update[:message].delete(:text)

    deliver update

    assert_response :ok
    assert_empty response.body
  end

  private
    # Posts the update the way Telegram does.
    def deliver(update, secret: Rails.configuration.x.telegram.webhook_secret)
      post telegram_webhook_url, params: update, as: :json,
        headers: { "X-Telegram-Bot-Api-Secret-Token" => secret }.compact
    end

    def message_update(text, from:, chat_type: "private")
      {
        update_id: 1,
        message: { message_id: 1, date: Time.current.to_i, from: from, chat: { id: from[:id], type: chat_type }, text: text }
      }
    end

    def callback_update(data, from:)
      { update_id: 2, callback_query: { id: "77", from: from, chat_instance: "1", data: data } }
    end

    def reply
      response.parsed_body
    end
end
