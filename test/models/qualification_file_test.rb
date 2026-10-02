require "test_helper"

class QualificationFileTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  PDF = "%PDF-1.4\n% Квала 9\n".b

  class NoKey
    def read(*) = raise(QualificationReader::Unreadable, "Не задан ключ API модели")
  end

  setup { @race = Race.create!(name: "Этап 4 · Сочи") }

  test "knows a PDF, a photo and a screenshot by their first bytes" do
    assert_equal "application/pdf", QualificationFile.kind_of(PDF)
    assert_equal "image/jpeg", QualificationFile.kind_of("\xFF\xD8\xFF\xE0rest".b)
    assert_equal "image/png", QualificationFile.kind_of("\x89PNG\r\n\x1A\nrest".b)
    assert_equal "image/webp", QualificationFile.kind_of("RIFF\x00\x00\x00\x00WEBPVP8 ".b)
    assert_nil QualificationFile.kind_of("ftypheic".b)
  end

  test "refuses what the model cannot read" do
    file = @race.qualification_files.new(name: "IMG_1.heic", data: "\x00\x00\x00\x18ftypheic".b)

    assert_not file.valid?
    assert file.errors.include?(:content_type)
  end

  test "is read in the background once it is saved" do
    file = nil
    assert_enqueued_with(job: ReadQualificationJob) do
      file = @race.qualification_files.create!(name: "Квала 9.pdf", data: PDF)
    end

    assert file.waiting?
    assert_equal Digest::SHA256.hexdigest(PDF), file.checksum
  end

  test "keeps the best laps the model read, in milliseconds" do
    file = @race.qualification_files.create!(name: "Квала 9.pdf", data: PDF)
    file.read_protocol

    assert file.read?
    assert_equal 13, file.laps.size
    assert_equal [ 40_899 ], file.laps["1"]
    assert_equal "canned", file.model
  end

  test "a file that cannot be read says why" do
    file = @race.qualification_files.create!(name: "Квала 9.pdf", data: PDF)
    with_qualification(reader: NoKey.name) { file.read_protocol }

    assert file.failed?
    assert_equal "Не задан ключ API модели", file.error
  end

  test "the same bytes in the same race are not read twice" do
    first = @race.qualification_files.create!(name: "Квала 9.pdf", data: PDF)
    first.read_protocol

    assert_no_enqueued_jobs do
      second = @race.qualification_files.create!(name: "Квала 9 (1).pdf", data: PDF)
      assert second.reload.read?
      assert_equal first.laps, second.laps
      assert_equal [ "Тот же файл, что «Квала 9.pdf»" ], second.warnings
    end
  end
end
