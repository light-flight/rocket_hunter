require "test_helper"

class Api::QualificationFilesControllerTest < ActionDispatch::IntegrationTest
  RACE = "5f0c8a52-3d47-4e8e-9b0a-6f1d2c3b4a59"
  ID = "8c3f1d2e-4b5a-4c6d-9e7f-0a1b2c3d4e5f"
  PDF = "%PDF-1.4\n% Квала 9\n".b

  setup do
    sign_in_as users(:one)
    @race = Race.create!(id: RACE, name: "Этап 4 · Сочи")
  end

  def upload(bytes = PDF, name: "Квала 9.pdf", type: "application/pdf")
    Rack::Test::UploadedFile.new(StringIO.new(bytes), type, original_filename: name)
  end

  def send_file(id = ID, race: RACE, **params)
    put api_race_qualification_file_url(race, id), params: { file: upload, name: "Квала 9.pdf", **params }
  end

  test "every action needs a session" do
    sign_out

    get api_race_qualification_files_url(RACE)
    assert_response :unauthorized
    assert_no_difference("QualificationFile.count") { send_file }
    assert_response :unauthorized
  end

  test "takes a file in under the id the phone made and reads it in the background" do
    assert_enqueued_with(job: ReadQualificationJob) do
      send_file(added_at: 1.hour.ago.iso8601(3))
    end

    assert_response :created
    file = QualificationFile.find(ID)
    assert_equal [ "Квала 9.pdf", "application/pdf", PDF ], [ file.name, file.content_type, file.data ]
    assert_equal({ "id" => ID, "name" => "Квала 9.pdf", "status" => "waiting", "laps" => {}, "warnings" => [],
      "error" => nil, "added_at" => file.created_at.iso8601(3) }, response.parsed_body)
    assert_in_delta 1.hour.ago, file.created_at, 5
  end

  test "the same file sent again is not a second file" do
    send_file
    QualificationFile.find(ID).read_protocol

    assert_no_enqueued_jobs { send_file }
    assert_response :ok
    assert_equal "read", response.parsed_body["status"]
    assert_equal 1, QualificationFile.count
  end

  test "a file for a race the server does not have yet is not taken" do
    assert_no_difference("QualificationFile.count") { send_file(race: "6a1d9b63-4e58-4f9f-8c1b-7a2e3d4c5b6a") }
    assert_response :not_found
  end

  test "refuses what is neither a PDF nor a photo" do
    put api_race_qualification_file_url(RACE, ID), params: { file: upload("ftypheic".b, name: "IMG_1.heic", type: "image/heic") }

    assert_response :unsupported_media_type
    assert_not QualificationFile.exists?(ID)
  end

  test "refuses a file too large to read" do
    stub_const(QualificationFile, :SIZE_LIMIT, 10) { send_file }

    assert_response :content_too_large
  end

  test "lists the files of the race with what was read, without their bytes" do
    send_file
    QualificationFile.find(ID).read_protocol

    get api_race_qualification_files_url(RACE)

    assert_response :ok
    file = response.parsed_body["files"].sole
    assert_equal [ ID, "read" ], file.values_at("id", "status")
    assert_equal [ 40_899 ], file["laps"]["1"]
    assert_not file.key?("data")
  end

  test "deletes a file, and a file already gone is no error" do
    send_file

    2.times do
      delete api_race_qualification_file_url(RACE, ID)
      assert_response :no_content
    end
    assert_not QualificationFile.exists?(ID)
  end

  test "reads a file again" do
    send_file
    QualificationFile.find(ID).failed!("Модель недоступна, попробуйте прочитать позже")

    assert_enqueued_with(job: ReadQualificationJob) { post read_api_race_qualification_file_url(RACE, ID) }

    assert_response :ok
    assert_equal [ "waiting", nil ], response.parsed_body.values_at("status", "error")
  end

  test "refuses a request from another site" do
    assert_no_difference("QualificationFile.count") do
      put api_race_qualification_file_url(RACE, ID), params: { file: upload }, headers: { "Sec-Fetch-Site" => "cross-site" }
    end

    assert_response :forbidden
  end

  private
    def stub_const(owner, name, value)
      old = owner.const_get(name)
      owner.send(:remove_const, name)
      owner.const_set(name, value)
      yield
    ensure
      owner.send(:remove_const, name)
      owner.const_set(name, old)
    end
end
