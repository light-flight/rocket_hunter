module Api
  # Races are made on a phone first, often without a network, and arrive here when it is back.
  # The phone picks the id, so a race sent again is the same race, not a second one.
  class RacesController < BaseController
    def index
      render json: { races: Race.order(created_at: :desc).map { race_json(it) } }
    end

    # Creates the race or changes its name and corridors.
    def update
      race = Race.find_or_initialize_by(id: params[:id])
      created = race.new_record?
      race.name = race_params[:name]
      # A phone still on a version from before corridors sends none: the race keeps its own.
      race.lanes = race_params[:lanes] if race_params.key?(:lanes)
      # When it was made on the phone, not when the phone got a network again.
      race.created_at = made_at if created

      if race.save
        render json: race_json(race), status: created ? :created : :ok
      else
        head :unprocessable_content
      end
    rescue ActiveRecord::RecordNotUnique
      # The same race sent twice at once: the other request created it, so this one renames it.
      retry
    end

    private
      def race_params
        params.expect(race: %i[ name created_at lanes ])
      end

      # A clock that runs fast must not put a race ahead of the ones made later.
      def made_at
        time = Time.zone.parse(race_params[:created_at].to_s)
        [ time, Time.current ].min if time
      rescue ArgumentError
        nil
      end

      def race_json(race)
        { id: race.id, name: race.name, lanes: race.lanes, created_at: race.created_at.iso8601(3) }
      end
  end
end
