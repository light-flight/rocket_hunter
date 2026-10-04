# One race weekend. Every manager of the team sees every race; the work at the track is done
# inside one of them.
class Race < ApplicationRecord
  NAME_LIMIT = 100

  has_many :qualification_files, dependent: :delete_all
  has_one :pit_log, dependent: :delete

  # Control characters too: PostgreSQL refuses a NUL in a string.
  normalizes :name, with: ->(name) { name.gsub(/[[:cntrl:]]/, " ").squish }

  validates :name, presence: true, length: { maximum: NAME_LIMIT }

  # The karts of the qualification, fastest first: each one's best laps averaged across the
  # protocols read, and its pace from 0 (the fastest) to 1 (the slowest). The pace follows the
  # time, not the place: karts a tenth apart stay close, a kart seconds behind stands apart.
  # A best lap that comes in two protocols (the same sheet as a photo and as a PDF) counts once.
  def karts
    laps = Hash.new { |hash, kart| hash[kart] = [] }
    qualification_files.read.pluck(:laps).flat_map(&:to_a).each do |kart, times|
      times.each { |ms| laps[kart] << ms unless laps[kart].include?(ms) }
    end

    karts = laps.map { |kart, times| { kart: kart, average: (times.sum.to_f / times.size).round, laps: times.size } }
    fastest, slowest = karts.map { it[:average] }.minmax
    karts
      .map { it.merge(pace: slowest == fastest ? 0.0 : ((it[:average] - fastest).fdiv(slowest - fastest)).round(3)) }
      .sort_by { [ it[:average], -it[:laps], it[:kart].to_i, it[:kart] ] }
  end
end
