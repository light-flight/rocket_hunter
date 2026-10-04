require "test_helper"

class UserTest < ActiveSupport::TestCase
  test "name_from joins the first and the last name" do
    assert_equal "Иван Петров", User.name_from("first_name" => "Иван", "last_name" => "Петров", "username" => "ivan")
  end

  test "name_from falls back to the username" do
    assert_equal "ivan", User.name_from("first_name" => " ", "username" => "ivan")
  end

  test "name_from falls back to a placeholder" do
    assert_equal "Менеджер", User.name_from({})
  end

  JPEG = "\xFF\xD8\xFF\xE0photo".b

  # Answers like TelegramBot, with the photos given; remembers what it was asked.
  class FakeBot
    attr_reader :calls

    def initialize(photos, data: JPEG)
      @photos, @data, @calls = photos, data, []
    end

    def call(method, **params)
      @calls << method
      case method
      when "getUserProfilePhotos" then { "total_count" => @photos.size, "photos" => @photos }
      when "getFile" then { "file_id" => params[:file_id], "file_path" => "profile_photos/#{params[:file_id]}.jpg" }
      end
    end

    def download(file_path, limit:)
      @calls << file_path
      @data
    end
  end

  def photo(*widths)
    widths.map { { "file_id" => "id#{it}", "file_unique_id" => "u#{it}", "width" => it, "height" => it } }
  end

  test "refresh_avatar copies the smallest size still sharp in the circle" do
    user = users(:one)
    bot = FakeBot.new([ photo(160, 320, 640), photo(160) ])

    user.refresh_avatar(bot: bot)

    assert_equal [ "getUserProfilePhotos", "getFile", "profile_photos/id160.jpg" ], bot.calls
    assert_equal [ "u160", JPEG ], [ user.avatar.telegram_file_id, user.avatar.data ]
    assert_equal "/api/avatar?v=#{Digest::SHA256.hexdigest(JPEG).first(16)}", user.avatar_url
  end

  test "refresh_avatar takes the largest size when every one is small" do
    user = users(:one)

    user.refresh_avatar(bot: FakeBot.new([ photo(80, 120) ]))

    assert_equal "u120", user.avatar.telegram_file_id
  end

  test "refresh_avatar does not download the same photo again" do
    user = users(:one)
    user.refresh_avatar(bot: FakeBot.new([ photo(160) ]))
    bot = FakeBot.new([ photo(160) ])

    user.refresh_avatar(bot: bot)

    assert_equal [ "getUserProfilePhotos" ], bot.calls
  end

  test "refresh_avatar replaces a photo the manager changed" do
    user = users(:one)
    user.refresh_avatar(bot: FakeBot.new([ photo(160) ]))

    user.refresh_avatar(bot: FakeBot.new([ photo(320) ], data: "\xFF\xD8\xFFnew".b))

    assert_equal 1, Avatar.count
    assert_equal [ "u320", "\xFF\xD8\xFFnew".b ], [ user.reload.avatar.telegram_file_id, user.avatar.data ]
  end

  test "refresh_avatar forgets the photo of a manager who has none any more" do
    user = users(:one)
    user.refresh_avatar(bot: FakeBot.new([ photo(160) ]))

    user.refresh_avatar(bot: FakeBot.new([]))

    assert_nil user.reload.avatar
    assert_nil user.avatar_url
  end

  test "refresh_avatar keeps nothing that is not a JPEG" do
    user = users(:one)

    assert_raises(TelegramBot::Error) { user.refresh_avatar(bot: FakeBot.new([ photo(160) ], data: "<html>".b)) }
    assert_nil user.reload.avatar
  end

  test "destroy removes the manager's sessions and links and keeps the people he invited" do
    user = users(:one)
    user.sessions.create!
    user.refresh_avatar(bot: FakeBot.new([ photo(160) ]))
    invitee = User.create!(telegram_id: 2001, name: "Пётр Новиков", invited_by: user)

    user.destroy!

    assert_nil invitee.reload.invited_by
    assert_equal [ 0, 0, 0, 0 ], [ Session.count, Invitation.count, SignInAttempt.where.not(user: nil).count, Avatar.count ]
  end
end
