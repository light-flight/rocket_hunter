require "test_helper"

class Api::HealthControllerTest < ActionDispatch::IntegrationTest
  test "answers ok as JSON" do
    get api_health_url

    assert_response :success
    assert_equal({ "status" => "ok" }, response.parsed_body)
  end
end
