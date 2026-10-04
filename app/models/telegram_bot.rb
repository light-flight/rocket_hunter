require "net/http"

# Calls the Bot API: only from background jobs, never while Telegram waits for a webhook answer.
# The bot token is in the path of every address here, so no address ever goes into an error
# message or a log.
class TelegramBot
  # Telegram is out of reach or busy: worth trying again later.
  class Unavailable < StandardError; end
  # Telegram refused the call.
  class Error < StandardError; end

  NETWORK_ERRORS = [ Timeout::Error, SocketError, SystemCallError, OpenSSL::SSL::SSLError, EOFError, Net::HTTPBadResponse ].freeze

  def self.configured?
    Rails.configuration.x.telegram.bot_token.present?
  end

  def initialize(token: Rails.configuration.x.telegram.bot_token)
    raise Error, "No bot token: telegram.bot_token in the credentials or TELEGRAM_BOT_TOKEN" if token.blank?
    # URI() quotes the whole address, token included, when it cannot parse it.
    raise Error, "The bot token does not look like a bot token" unless token.match?(/\A\d+:[\w-]+\z/)

    @token = token
  end

  # -> the "result" of the answer.
  def call(method, **params)
    response = request(Net::HTTP::Post.new(uri("/bot#{@token}/#{method}"), "Content-Type" => "application/json"), params.to_json)
    body = JSON.parse(response.body) rescue nil
    return body["result"] if body&.dig("ok")

    raise Unavailable, "#{method}: #{response.code}" if response.code == "429" || response.code.start_with?("5")
    raise Error, "#{method}: #{body&.dig("description") || response.code}"
  end

  # The bytes of a file at the file_path that getFile gave.
  def download(file_path, limit:)
    # Checked here because URI::HTTPS.build puts the whole path, token included, in its errors.
    raise Error, "file: an unexpected file_path" unless file_path.to_s.match?(%r{\A[\w-]+(/[\w.-]+)*\z})

    response = request(Net::HTTP::Get.new(uri("/file/bot#{@token}/#{file_path}")))
    raise Unavailable, "file: #{response.code}" if response.code == "429" || response.code.start_with?("5")
    raise Error, "file: #{response.code}" unless response.is_a?(Net::HTTPSuccess)
    raise Error, "file: larger than #{limit} bytes" if response.body.bytesize > limit

    response.body.b
  end

  private
    def uri(path)
      URI::HTTPS.build(host: "api.telegram.org", path: path)
    end

    def request(request, body = nil)
      Net::HTTP.start(request.uri.host, request.uri.port, use_ssl: true, open_timeout: 5, read_timeout: 15) do |http|
        http.request(request, body)
      end
    rescue *NETWORK_ERRORS => error
      raise Unavailable, error.class.name
    end
end
