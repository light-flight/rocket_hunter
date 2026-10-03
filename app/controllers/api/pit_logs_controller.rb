module Api
  # The pits of a race. The phone that enters them sends the whole log after every change, so a
  # log sent again is just the same log; the other phones read it.
  class PitLogsController < BaseController
    before_action :set_race

    def show
      render json: log_json(@race.pit_log || @race.build_pit_log)
    end

    def update
      log = @race.pit_log || @race.build_pit_log
      log.assign_attributes(moves: moves, count: params.expect(pit_log: [ :count ])[:count])

      if log.save
        render json: log_json(log)
      else
        head :unprocessable_content
      end
    rescue ActiveRecord::RecordNotUnique
      # Two sends at once: the other one made the log, this one writes over it.
      retry
    end

    private
      def set_race
        @race = Race.find(params[:race_id])
      end

      # Each move as the phone wrote it: a corridor and a kart, or null for an unknown kart.
      def moves
        Array(params.dig(:pit_log, :moves)).map do |move|
          move = move.permit(:lane, :kart) if move.respond_to?(:permit)
          move.respond_to?(:[]) ? { "lane" => move["lane"], "kart" => move["kart"] } : move
        end
      end

      def log_json(log)
        { moves: log.moves, count: log.count }
      end
  end
end
