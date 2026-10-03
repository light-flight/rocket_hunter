module Api
  # The pits of a race. A phone sends what was done on it that the server has not confirmed yet: the
  # moves it entered and the ids of the moves it undid. The log here takes in what it does not have,
  # so a send that is repeated, late, or crosses one from another phone changes nothing that it should
  # not. The phones read the log back, only what they have not read yet: both lists only grow at
  # their end.
  class PitLogsController < BaseController
    before_action :set_race

    # With moves=N&undone=M, how much of each list the phone has read, and moves_last and undone_last,
    # the id of the last one of each it read: it gets the rest.
    def show
      log = @race.pit_log || @race.build_pit_log
      from = { moves: read(log.moves, :moves), undone: read(log.undone, :undone) }

      render json: { moves: log.moves.drop(from[:moves]), undone: log.undone.drop(from[:undone]), from: from,
        total: { moves: log.moves.size, undone: log.undone.size } }
    end

    def update
      moves, undone = sent(:moves), sent(:undone)
      return head :unprocessable_content unless moves && undone

      # One writer of a race at a time: what another phone sent meanwhile is taken in, not written over.
      @race.with_lock do
        log = @race.pit_log || @race.build_pit_log
        log.take(moves, undone)
        log.save ? head(:no_content) : head(:unprocessable_content)
      end
    end

    private
      def set_race
        @race = Race.find(params[:race_id])
      end

      # How much of a list the phone has read. 0, so the whole list, when it says nothing that makes
      # sense, more than the list has, or a last one read that is not the one at that place here: the
      # server lost what the phone read (restored from a copy, perhaps grown back since), and the
      # phone can only tell what is missing here from the whole list.
      def read(list, kind)
        count = params[kind]
        return 0 unless count.is_a?(String) && count.match?(/\A\d+\z/) && count.to_i <= list.size

        count = count.to_i
        last = list[count - 1] if count.positive?
        count.zero? || (last.is_a?(Hash) ? last["id"] : last) == params[:"#{kind}_last"] ? count : 0
      end

      # One list the phone sends, each element as the phone wrote it, so the log refuses whatever no
      # phone would send. Nothing of that kind when it sends none; nil when it is not a list.
      def sent(kind)
        log = params.fetch(:pit_log)
        list = log.is_a?(ActionController::Parameters) ? log.fetch(kind, []) : nil
        list.map { it.is_a?(ActionController::Parameters) ? it.to_unsafe_h.to_h : it } if list.is_a?(Array)
      end
  end
end
