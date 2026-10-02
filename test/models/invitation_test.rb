require "test_helper"

class InvitationTest < ActiveSupport::TestCase
  test "accept creates the manager and uses up the invitation" do
    invitation = invitations(:pending)

    user = Invitation.accept(invitation.token, telegram_id: 2001, name: "Пётр Новиков", username: "novikov")

    assert_predicate user, :persisted?
    assert_equal 2001, user.telegram_id
    assert_equal "Пётр Новиков", user.name
    assert_equal "novikov", user.username
    assert_equal users(:one), user.invited_by
    assert_not Invitation.exists?(invitation.id)
  end

  test "accept works once" do
    token = invitations(:pending).token
    Invitation.accept(token, telegram_id: 2001, name: "Пётр Новиков", username: nil)

    assert_no_difference "User.count" do
      assert_nil Invitation.accept(token, telegram_id: 2002, name: "Олег Быстров", username: nil)
    end
  end

  test "accept refuses an expired invitation" do
    assert_no_difference "User.count" do
      assert_nil Invitation.accept(invitations(:expired).token, telegram_id: 2001, name: "Пётр Новиков", username: nil)
    end
  end

  test "accept refuses an unknown token" do
    assert_no_difference "User.count" do
      assert_nil Invitation.accept("unknown", telegram_id: 2001, name: "Пётр Новиков", username: nil)
    end
  end
end
