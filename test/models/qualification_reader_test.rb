require "test_helper"

class QualificationReaderTest < ActiveSupport::TestCase
  # Stands in for Anthropic::Client: keeps the request, gives back a prepared answer.
  class FakeClient
    attr_reader :request

    def initialize(message) = @message = message
    def beta = self
    def messages = self

    def create(**request)
      @request = request
      @message
    end
  end

  Text = Struct.new(:type, :text)
  Usage = Struct.new(:input_tokens, :output_tokens)
  Message = Struct.new(:content, :stop_reason, :model, :usage)

  def answer(json, stop_reason: :end_turn)
    Message.new([ Text.new(:text, json) ], stop_reason, :"claude-opus-5-5", Usage.new(1000, 200))
  end

  def read_with(message, data = "%PDF-1.4".b, type = "application/pdf")
    client = FakeClient.new(message)
    [ QualificationReader.new(client: client).read(data, type), client.request ]
  end

  test "sends the protocol to the model and asks for rows in a fixed shape" do
    result, request = read_with(answer('{"rows":[{"kart":"5","best_lap":"40.947"}],"warnings":[]}'))

    assert_equal({ rows: [ { "kart" => "5", "best_lap" => "40.947" } ], warnings: [], model: "claude-opus-5-5" }, result)
    assert_equal "claude-opus-5-5", request[:model]
    assert_equal QualificationReader::SCHEMA, request.dig(:output_config, :format, :schema)
    assert_equal :default, request[:fallbacks]
    document = request[:messages].first[:content].first
    assert_equal [ :document, "application/pdf", Base64.strict_encode64("%PDF-1.4") ],
      [ document[:type], document.dig(:source, :media_type), document.dig(:source, :data) ]
  end

  test "a photo goes as an image" do
    _, request = read_with(answer('{"rows":[],"warnings":[]}'), "\xFF\xD8\xFF".b, "image/jpeg")

    assert_equal :image, request[:messages].first[:content].first[:type]
  end

  test "keeps the model's notes few and short" do
    result, = read_with(answer({ rows: [], warnings: Array.new(8) { "а" * 300 } }.to_json))

    assert_equal 5, result[:warnings].size
    assert_equal 200, result[:warnings].first.length
  end

  test "a refusal, a cut-off answer or a malformed one is a file that could not be read" do
    assert_raises(QualificationReader::Unreadable) { read_with(answer("", stop_reason: :refusal)) }
    assert_raises(QualificationReader::Unreadable) { read_with(answer('{"rows":[', stop_reason: :max_tokens)) }
    assert_raises(QualificationReader::Unreadable) { read_with(answer("Вот протокол:")) }
  end

  test "without an API key nothing is sent" do
    error = assert_raises(QualificationReader::Unreadable) { QualificationReader.new.read("%PDF-1.4".b, "application/pdf") }

    assert_equal "Не задан ключ API модели", error.message
  end

  test "the tests read with a stand-in, the app with the model" do
    assert_instance_of QualificationReader::Canned, QualificationReader.build

    with_qualification(reader: nil) { assert_instance_of QualificationReader, QualificationReader.build }
  end
end
