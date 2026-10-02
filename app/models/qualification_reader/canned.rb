# Stands in for the model in the tests and in the end-to-end run: reads nothing, answers
# with the karts of a real protocol, «Квала 9».
class QualificationReader::Canned
  ROWS = [
    %w[ 1 40.899 ], %w[ 11 41.167 ], %w[ 9 41.193 ], %w[ 5 41.256 ], %w[ 2 41.367 ], %w[ 3 41.381 ],
    %w[ 16 41.430 ], %w[ 17 41.548 ], %w[ 15 41.599 ], %w[ 12 41.935 ], %w[ 13 42.062 ], %w[ 10 42.193 ],
    %w[ 20 42.496 ]
  ].map { |kart, lap| { "kart" => kart, "best_lap" => lap } }.freeze

  def model = "canned"

  def read(_data, _content_type)
    { rows: ROWS, warnings: [], model: model }
  end
end
