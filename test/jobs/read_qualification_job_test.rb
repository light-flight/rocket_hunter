require "test_helper"

class ReadQualificationJobTest < ActiveJob::TestCase
  class OutOfReach
    def read(*) = raise(Anthropic::Errors::APIConnectionError.new(url: URI("https://api.anthropic.com")))
  end

  class Broken
    def read(*) = raise(NoMethodError, "oops")
  end

  setup do
    race = Race.create!(name: "Этап 4 · Сочи")
    @file = race.qualification_files.create!(name: "Квала 9.pdf", data: "%PDF-1.4".b)
  end

  test "reads the protocol" do
    ReadQualificationJob.perform_now(@file)

    assert @file.reload.read?
  end

  test "a model out of reach is tried again, then the file is marked failed" do
    with_qualification(reader: OutOfReach.name) do
      perform_enqueued_jobs(only: ReadQualificationJob) { ReadQualificationJob.perform_later(@file) }
    end

    assert @file.reload.failed?
    assert_equal "Модель недоступна, попробуйте прочитать позже", @file.error
  end

  test "an error of the app itself never leaves the file reading" do
    with_qualification(reader: Broken.name) do
      assert_raises(NoMethodError) { ReadQualificationJob.perform_now(@file) }
    end

    assert @file.reload.failed?
  end

  test "a file deleted before its turn is skipped" do
    ReadQualificationJob.perform_later(@file)
    @file.delete

    assert_nothing_raised { perform_enqueued_jobs }
  end
end
