# A qualification protocol of a race, as a manager picked it on the phone: a PDF, a photo or
# a screenshot. The model reads it in the background; what it read is kept as each kart's best
# laps in milliseconds, and the phones average them across the files of the race.
class QualificationFile < ApplicationRecord
  # A PDF of a few pages, or any photo: the phone makes photos smaller before sending them.
  SIZE_LIMIT = 20.megabytes
  NAME_LIMIT = 200
  # The kinds the model reads, told by their first bytes rather than by what the phone says.
  KINDS = {
    "application/pdf" => "%PDF-".b,
    "image/jpeg" => "\xFF\xD8\xFF".b,
    "image/png" => "\x89PNG\r\n\x1A\n".b,
    "image/gif" => "GIF8".b
  }.freeze

  belongs_to :race

  enum :status, %w[ waiting reading read failed ].index_by(&:itself), default: :waiting, validate: true

  normalizes :name, with: ->(name) { name.gsub(/[[:cntrl:]]/, " ").squish.truncate(NAME_LIMIT) }

  before_validation :describe_data, on: :create
  validates :name, presence: true
  validates :content_type, inclusion: { in: [ *KINDS.keys, "image/webp" ], message: "не PDF и не фото" }
  validates :data, length: { maximum: SIZE_LIMIT }, on: :create

  after_create_commit :read_later

  # Everything but the bytes: lists never need them.
  scope :listed, -> { select(column_names - %w[ data ]) }

  def self.kind_of(data)
    return "image/webp" if data.byteslice(0, 4) == "RIFF".b && data.byteslice(8, 4) == "WEBP".b

    KINDS.find { |_, start| data.start_with?(start) }&.first
  end

  # The same bytes already read in this race are not read again: the result is taken over.
  def read_later
    twin = race.qualification_files.listed.read.where(checksum: checksum).where.not(id: id).first
    if twin
      update!(status: :read, laps: twin.laps, warnings: [ "Тот же файл, что «#{twin.name}»" ], model: twin.model, error: nil)
    else
      update!(status: :waiting, error: nil)
      ReadQualificationJob.perform_later(self)
    end
  end

  def read_protocol
    reading!
    answer = QualificationReader.build.read(self.class.where(id: id).pick(:data), content_type)
    protocol = Protocol.new(answer[:rows])
    update!(status: :read, laps: protocol.laps, warnings: answer[:warnings] + protocol.warnings, model: answer[:model], error: nil)
  rescue QualificationReader::Unreadable => error
    failed!(error.message)
  end

  def failed!(reason)
    update!(status: :failed, error: reason)
  end

  private
    def describe_data
      return if data.nil?

      self.content_type = self.class.kind_of(data)
      self.checksum = Digest::SHA256.hexdigest(data)
    end
end
