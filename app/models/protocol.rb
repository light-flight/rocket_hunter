# What the model wrote out of one qualification protocol, made into numbers the app can trust.
# The model only copies kart numbers and times as printed; reading them is done here, so a
# time it copied wrong cannot pass as a lap without a warning.
class Protocol
  # Anything outside is not a lap of a kart: a gap, a lap count, a clock.
  LAP = 15_000..300_000
  # Further than this from the protocol's own middle, a time was misread or is not a best lap.
  SPREAD = 0.8..1.25

  # [hours:]minutes, seconds, fraction. Hours and minutes count only with seconds after them.
  TIME = /\A(?:(?<h>\d{1,2}):(?=\d{1,2}[:.]\d{1,3}[.,]))?(?:(?<m>\d{1,2})[:.](?=\d{1,3}[.,]))?(?<s>\d{1,3})[.,](?<f>\d{1,3})\z/

  attr_reader :laps, :warnings

  # rows: [{ "kart" => "07", "best_lap" => "1:02,345" }, ...]
  def initialize(rows)
    @warnings = []
    times = rows.filter_map { |row| read_row(row) }.uniq
    @laps = keep_plausible(times).each_with_object({}) { |(kart, ms), laps| (laps[kart] ||= []) << ms }
  end

  # "1:02.345", "01:02.345", "62.345", "1.02.345", "1:02,3" or "00:01:02.345" -> milliseconds.
  def self.milliseconds(text)
    match = text.to_s.strip.match(TIME)
    return unless match
    return if match[:m] && match[:s].to_i >= 60

    ((match[:h].to_i * 60 + match[:m].to_i) * 60 + match[:s].to_i) * 1000 + match[:f].ljust(3, "0").to_i
  end

  # "07", "№7", "#07" -> "7"; Cyrillic letters that look Latin become Latin: "12А" -> "12A".
  def self.kart(text)
    # № first: normalizing would make it "No".
    kart = text.to_s.gsub(/[\s№#]/, "").unicode_normalize(:nfkc).upcase.tr("АВЕКМНОРСТХ", "ABEKMHOPCTX")
    kart = kart.sub(/\A0+(?=\d)/, "")
    kart if kart.match?(/\A\d{1,3}[A-Z]?\z/)
  end

  private
    def read_row(row)
      kart = self.class.kart(row["kart"])
      ms = self.class.milliseconds(row["best_lap"])

      if kart.nil?
        @warnings << "Не понятен номер карта «#{row["kart"]}» — время не учтено"
        nil
      elsif ms.nil? || !LAP.cover?(ms)
        @warnings << "Карт #{kart}: «#{row["best_lap"]}» не похоже на время круга — не учтено"
        nil
      else
        [ kart, ms ]
      end
    end

    def keep_plausible(times)
      middle = median(times.map(&:last))
      times.select do |kart, ms|
        next true if SPREAD.cover?(ms.fdiv(middle))

        @warnings << "Карт #{kart}: #{format_lap(ms)} слишком далеко от остальных — не учтено"
        false
      end
    end

    def median(values)
      sorted = values.sort
      sorted.empty? ? 0 : (sorted[(sorted.size - 1) / 2] + sorted[sorted.size / 2]) / 2.0
    end

    def format_lap(ms)
      minutes, rest = ms.divmod(60_000)
      seconds = format("%06.3f", rest / 1000.0)
      minutes.zero? ? seconds.delete_prefix("0") : "#{minutes}:#{seconds}"
    end
end
