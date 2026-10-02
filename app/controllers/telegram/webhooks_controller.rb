module Telegram
  # Receives the bot's updates. The reply travels in the body of the response, so the server
  # never calls Telegram. Replies are fixed texts: nothing a sender typed is echoed back.
  #
  # A valid update always gets a 200, because Telegram repeats an update answered with
  # anything else. No update_id bookkeeping is needed: a repeated update finds the work
  # already done and gets a harmless answer.
  class WebhooksController < ActionController::API
    # The full address: Telegram for iPhone opens a bare domain over http. The page itself
    # leads the manager through installing the app, whatever browser it opens in.
    WELCOME = "Вы в команде Rocket Hunter.\nОткройте https://app.rocket-hunter.ru"
    HELP = "Чтобы войти, откройте приложение Rocket Hunter и нажмите «Войти через Telegram»."
    REFUSAL = "Это бот команды Rocket Hunter. Вход только по приглашению: попросите ссылку у менеджера команды. " \
      "Если ссылка у вас была, она уже использована или устарела."
    CONFIRMED = "Готово. Вернитесь в приложение Rocket Hunter — вход выполнится сам."
    REJECTED = "Вход отклонён."
    STALE = "Запрос устарел. Начните вход в приложении заново."

    before_action :verify_secret

    def create
      if private_text_message?
        render json: { method: "sendMessage", chat_id: params[:message][:chat][:id], **reply_to(params[:message]) }
      elsif callback = params[:callback_query]
        render json: {
          method: "answerCallbackQuery", callback_query_id: callback[:id], text: answer_to(callback), show_alert: true
        }
      else
        head :ok
      end
    end

    private
      def verify_secret
        secret = Rails.configuration.x.telegram.webhook_secret
        given = request.headers["X-Telegram-Bot-Api-Secret-Token"].to_s

        # A missing secret must not open the endpoint: secure_compare("", "") is true.
        head :forbidden unless secret.present? && ActiveSupport::SecurityUtils.secure_compare(given, secret)
      end

      def private_text_message?
        message = params[:message]
        message && message.dig(:chat, :type) == "private" && message[:text].is_a?(String) && message.dig(:from, :id)
      end

      def reply_to(message)
        sender = message[:from]
        manager = User.find_by(telegram_id: sender[:id])
        token = message[:text][%r{\A/start (\w+)\z}, 1]

        if token && (attempt = SignInAttempt.active.find_by(token: token, user: nil))
          manager ? confirm_prompt(attempt) : { text: REFUSAL }
        elsif token && !manager && accept_invitation(token, sender)
          { text: WELCOME }
        else
          { text: manager ? HELP : REFUSAL }
        end
      end

      def accept_invitation(token, sender)
        Invitation.accept(token, telegram_id: sender[:id], name: User.name_from(sender), username: sender[:username])
      end

      # Opening the link never signs anyone in: the manager has to press the button.
      def confirm_prompt(attempt)
        seconds = (Time.current - attempt.created_at).to_i

        {
          text: "Запрос на вход в Rocket Hunter.\n" \
            "Устройство: #{attempt.device}. Запрошен #{seconds} с назад.\n" \
            "Если это вы, нажмите «Войти».",
          reply_markup: { inline_keyboard: [ [
            { text: "Войти", callback_data: "confirm:#{attempt.token}" },
            { text: "Это не я", callback_data: "reject:#{attempt.token}" }
          ] ] }
        }
      end

      def answer_to(callback)
        manager = User.find_by(telegram_id: callback.dig(:from, :id))
        action, token = callback[:data].to_s.split(":", 2)
        attempt = SignInAttempt.active.find_by(token: token) if manager && token

        if attempt && action == "confirm" && (attempt.user.nil? || attempt.user == manager)
          attempt.update!(user: manager)
          CONFIRMED
        elsif attempt && action == "reject"
          attempt.destroy!
          REJECTED
        else
          STALE
        end
      end
  end
end
