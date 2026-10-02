require "test_helper"

class Api::InvitationsControllerTest < ActionDispatch::IntegrationTest
  test "create requires a session" do
    assert_no_difference "Invitation.count" do
      post api_invitations_url
    end

    assert_response :unauthorized
  end

  test "create answers with a link to the bot" do
    sign_in_as users(:one)

    assert_difference "Invitation.count", 1 do
      post api_invitations_url
    end

    assert_response :created
    invitation = Invitation.order(:created_at).last
    assert_equal users(:one), invitation.user
    assert_equal({ "url" => "https://t.me/#{Rails.configuration.x.telegram.bot_username}?start=#{invitation.token}" },
      response.parsed_body)
  end
end
