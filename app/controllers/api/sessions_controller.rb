module Api
  class SessionsController < BaseController
    allow_unauthenticated_access only: :create
    # Each signing-in phone polls create every 3 seconds, and managers at a track share one IP.
    rate_limit to: 120, within: 1.minute, only: :create, with: -> { head :too_many_requests }

    def show
      render json: user_json(Current.user)
    end

    # Answers 202 until a manager confirms the attempt in the bot. The lock makes a confirmed
    # attempt start exactly one session.
    def create
      SignInAttempt.transaction do
        attempt = SignInAttempt.active.lock.find_by(id: cookies.signed[:sign_in_attempt_id])

        if attempt.nil?
          cookies.delete(:sign_in_attempt_id)
          head :gone
        elsif attempt.user.nil?
          head :accepted
        else
          attempt.destroy!
          start_new_session_for attempt.user
          cookies.delete(:sign_in_attempt_id)
          render json: user_json(attempt.user), status: :created
        end
      end
    end

    def destroy
      terminate_session
      head :no_content
    end

    private
      # The Telegram id stays on the server.
      def user_json(user)
        { user: { name: user.name, avatar: user.avatar_url } }
      end
  end
end
