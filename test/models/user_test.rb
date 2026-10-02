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

  test "destroy removes the manager's sessions and links and keeps the people he invited" do
    user = users(:one)
    user.sessions.create!
    invitee = User.create!(telegram_id: 2001, name: "Пётр Новиков", invited_by: user)

    user.destroy!

    assert_nil invitee.reload.invited_by
    assert_equal [ 0, 0, 0 ], [ Session.count, Invitation.count, SignInAttempt.where.not(user: nil).count ]
  end
end
