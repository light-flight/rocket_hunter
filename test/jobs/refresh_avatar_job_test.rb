require "test_helper"

class RefreshAvatarJobTest < ActiveJob::TestCase
  test "a manager deleted before the job's turn is skipped" do
    assert_nothing_raised { RefreshAvatarJob.perform_now(0) }
  end
end
