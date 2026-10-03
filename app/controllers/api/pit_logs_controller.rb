module Api
  # The pits of a race. A phone sends the whole log after every change, with the version of the log
  # here its changes are based on, under an id of that send. A log sent again is just the same log.
  # A phone that is behind gets the log here back with 409, merges its changes into it and sends
  # the result; the other phones read it. A phone whose answer was lost sends the same log under the
  # same id until it has one, and learns that it was taken even if other phones wrote after it.
  class PitLogsController < BaseController
    before_action :set_race

    def show
      render json: log_json(@race.pit_log || @race.build_pit_log)
    end

    def update
      # One writer of a race at a time: the version read here is still the current one when saved.
      @race.with_lock do
        log = @race.pit_log || @race.build_pit_log

        if (version = taken_before(log))
          # Taken before and the answer lost: the phone learns which version its log became, and
          # merges what the other phones did after it from there.
          render json: { moves: moves, count: log_params[:count], version: version }
        elsif log.count == log_params[:count] && log.moves == moves
          # Sent again after a lost answer, or by a phone with the same log: nothing to write.
          render json: log_json(log)
        elsif !based_on?(log)
          render json: log_json(log), status: :conflict
        elsif log.update(moves: moves, count: log_params[:count], version: log.version + 1, sends: sends_after(log))
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
        @log_params ||= params.expect(pit_log: %i[ count version send ])
      end

      # Each move just as the phone wrote it (a corridor, a team or null for a spare kart, and when),
      # so that the log refuses whatever no phone would send.
      def moves
        @moves ||= Array(params.dig(:pit_log, :moves)).map { it.respond_to?(:to_unsafe_h) ? it.to_unsafe_h.to_h : it }
      end

      # The id the phone gave this send. nil from a phone that gives none.
      def send_id
        id = log_params[:send]
        id.presence if id.is_a?(String)
      end

      # The version this very send made when it was taken before. nil if it was not.
      def taken_before(log)
        taken, version = log.sends[Current.session.id.to_s]
        version if send_id && taken == send_id
      end

      # The last send taken from each phone, once this one is.
      def sends_after(log)
        send_id ? log.sends.merge(Current.session.id.to_s => [ send_id, log.version + 1 ]) : log.sends
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
