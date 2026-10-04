require "test_helper"

class TelegramBotTest < ActiveSupport::TestCase
  test "needs a bot token" do
    assert_raises(TelegramBot::Error) { TelegramBot.new(token: nil) }
  end

  test "refuses a token that is not a bot token, without quoting it" do
    error = assert_raises(TelegramBot::Error) { TelegramBot.new(token: "not a token/secret") }

    assert_no_match(/secret/, error.message)
  end

  test "refuses an unexpected file path before calling Telegram, without quoting the token" do
    error = assert_raises(TelegramBot::Error) { TelegramBot.new(token: "123:secret").download("../x y", limit: 10) }

    assert_no_match(/secret/, error.message)
  end
end
