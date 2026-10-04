require "test_helper"

class Api::AvatarsControllerTest < ActionDispatch::IntegrationTest
  setup { @user = users(:one) }

  test "show without a session answers unauthorized" do
    get api_avatar_url

    assert_response :unauthorized
  end

  test "show answers not found for a manager without a photo" do
    sign_in_as @user

    get api_avatar_url

    assert_response :not_found
  end

  test "show gives the manager's own photo, to be kept by the phone" do
    Avatar.create!(user: @user, telegram_file_id: "a", data: "\xFF\xD8\xFFone".b, checksum: "c1")
    Avatar.create!(user: users(:two), telegram_file_id: "b", data: "\xFF\xD8\xFFtwo".b, checksum: "c2")
    sign_in_as @user

    get api_avatar_url(v: "c1")

    assert_response :ok
    assert_equal "image/jpeg", response.media_type
    assert_equal "\xFF\xD8\xFFone".b, response.body.b
    assert_match(/private/, response.headers["Cache-Control"])
    assert_match(/immutable/, response.headers["Cache-Control"])
  end
end
