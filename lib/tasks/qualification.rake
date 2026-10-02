# Tries the model on a real protocol without the app: what it read and what the app keeps.
#   ANTHROPIC_API_KEY=... bin/rails "qualification:read[Квалификация 9.pdf]"
namespace :qualification do
  desc "Read one qualification protocol (PDF, JPEG, PNG) with the model and print the karts"
  task :read, [ :path ] => :environment do |_, args|
    abort "Usage: bin/rails \"qualification:read[path/to/protocol.pdf]\"" if args[:path].blank?

    data = File.binread(args[:path])
    kind = QualificationFile.kind_of(data) or abort "#{args[:path]} is neither a PDF nor a photo"
    answer = QualificationReader.new.read(data, kind)
    protocol = Protocol.new(answer[:rows])

    puts "Model: #{answer[:model]}"
    answer[:rows].each { |row| puts "  #{row["kart"].to_s.rjust(4)}  #{row["best_lap"]}" }
    puts "Kept: #{protocol.laps.to_json}"
    (answer[:warnings] + protocol.warnings).each { |warning| puts "Warning: #{warning}" }
  rescue QualificationReader::Unreadable => error
    abort error.message
  end
end
