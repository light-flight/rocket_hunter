# Reads one qualification protocol with the model. A call takes up to a minute, far longer than
# a request may: the phone sends the file, then asks how it went. The job carries the id, not
# the record: the record would bring its bytes along.
class ReadQualificationJob < ApplicationJob
  RETRYABLE = [ Anthropic::Errors::APIConnectionError, Anthropic::Errors::RateLimitError, Anthropic::Errors::InternalServerError ].freeze

  # The model is out of reach or busy: a few more tries, then the manager is told.
  retry_on(*RETRYABLE, wait: :polynomially_longer, attempts: 5) do |job, _error|
    QualificationFile.listed.find_by(id: job.arguments.first)&.failed!("Модель недоступна, попробуйте прочитать позже")
  end

  def perform(id)
    # Deleted before its turn came.
    file = QualificationFile.listed.find_by(id: id) or return
    file.read_protocol
  rescue => error
    # Whatever else went wrong, the file must not be left reading for ever.
    file&.failed!("Не удалось прочитать файл") unless RETRYABLE.any? { error.is_a?(it) }
    raise
  end
end
