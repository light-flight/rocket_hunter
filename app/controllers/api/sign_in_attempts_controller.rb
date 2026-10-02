module Api
  class SignInAttemptsController < BaseController
    allow_unauthenticated_access
    rate_limit to: 10, within: 3.minutes, with: -> { head :too_many_requests }

    def create
      attempt = SignInAttempt.start(user_agent: request.user_agent)

      # The token travels in a link that others may see. What claims the session is this
      # cookie, which never leaves the device that started the sign-in.
      cookies.signed[:sign_in_attempt_id] = {
        value: attempt.id, httponly: true, same_site: :lax, expires: SignInAttempt::LIFETIME
      }
      render json: { telegram_url: attempt.url, expires_in: SignInAttempt::LIFETIME.to_i }, status: :created
    end
  end
end
