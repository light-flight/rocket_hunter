# Stands in for the model in the tests and in the end-to-end run: does not read the protocol,
# answers with the karts of a real one, «Квала 9».
class QualificationReader::Canned
  ROWS = [
    %w[ 1 40.899 ], %w[ 11 41.167 ], %w[ 9 41.193 ], %w[ 5 41.256 ], %w[ 2 41.367 ], %w[ 3 41.381 ],
    %w[ 16 41.430 ], %w[ 17 41.548 ], %w[ 15 41.599 ], %w[ 12 41.935 ], %w[ 13 42.062 ], %w[ 10 42.193 ],
    %w[ 20 42.496 ]
  ].map { |kart, lap| { "kart" => kart, "best_lap" => lap } }.freeze
  # A file that says «Квала 10» has one kart more, as a protocol added later in a race may: the
  # end-to-end run sees its team come into the pits.
  LATER = "Квала 10".b.freeze
  LATER_ROWS = (ROWS + [ { "kart" => "33", "best_lap" => "41.700" } ]).freeze

  def model = "canned"

  def read(data, _content_type)
    { rows: data.to_s.b.include?(LATER) ? LATER_ROWS : ROWS, warnings: [], model: model }
  end
end
