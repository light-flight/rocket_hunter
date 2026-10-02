# Reads one qualification protocol with the model. A call takes up to a minute, far longer than
# a request may: the phone sends the file, then asks how it went.
class ReadQualificationJob < ApplicationJob
  # The model is out of reach or busy: a few more tries, then the manager is told.
  retry_on Anthropic::Errors::APIConnectionError, Anthropic::Errors::RateLimitError, Anthropic::Errors::InternalServerError,
    wait: :polynomially_longer, attempts: 5 do |job, _error|
    job.arguments.first.failed!("Модель недоступна, попробуйте прочитать позже")
  end

  # Deleted before its turn came.
  discard_on ActiveJob::DeserializationError

  def perform(file)
    file.read_protocol
  rescue => error
    # Whatever else went wrong, the file must not be left reading for ever.
    file.failed!("Не удалось прочитать файл") unless retryable?(error)
    raise
  end

  private
    def retryable?(error)
      [ Anthropic::Errors::APIConnectionError, Anthropic::Errors::RateLimitError, Anthropic::Errors::InternalServerError ]
        .any? { error.is_a?(it) }
    end
end
