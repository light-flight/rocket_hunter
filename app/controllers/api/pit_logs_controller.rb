module Api
  # The pits of a race. A phone sends the whole log after every change, with the version of the log
  # here its changes are based on. A log sent again is just the same log. A phone that is behind
  # gets the log here back with 409, merges its changes into it and sends the result; the other
  # phones read it.
  class PitLogsController < BaseController
    before_action :set_race

    def show
      render json: log_json(@race.pit_log || @race.build_pit_log)
    end

    def update
      # One writer of a race at a time: the version read here is still the current one when saved.
      @race.with_lock do
        log = @race.pit_log || @race.build_pit_log

        if log.count == log_params[:count] && log.moves == moves
          # Sent again after a lost answer, or by a phone with the same log: nothing to write.
          render json: log_json(log)
        elsif !based_on?(log)
          render json: log_json(log), status: :conflict
        elsif log.update(moves: moves, count: log_params[:count], version: log.version + 1)
          render json: log_json(log)
        else
          head :unprocessable_content
        end
      end
    rescue ActiveRecord::RecordNotUnique
      # The lock lets no other request make the log meanwhile; if one did, this one sees it now.
      retry
    end

    private
      def set_race
        @race = Race.find(params[:race_id])
      end

      def log_params
        @log_params ||= params.expect(pit_log: %i[ count version ])
      end

      # Each move as the phone wrote it: a corridor and a team, or null for a spare kart.
      def moves
        @moves ||= Array(params.dig(:pit_log, :moves)).map do |move|
          move = move.permit(:lane, :kart) if move.respond_to?(:permit)
          move.respond_to?(:[]) ? { "lane" => move["lane"], "kart" => move["kart"] } : move
        end
      end

      # Whether the phone's changes are made on the log here as it is now. A phone that has never
      # had it sends 0, the version only of a race with no log yet. A send with no version, or one
      # that is not a whole number, is never taken: it could write over the moves of another phone.
      def based_on?(log)
        version = log_params[:version]
        version.is_a?(Integer) && version == log.version
      end

      def log_json(log)
        { moves: log.moves, count: log.count, version: log.version }
      end
  end
end
