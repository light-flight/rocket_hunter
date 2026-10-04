module Api
  # The signed-in manager's Telegram profile photo. Its address names the picture
  # (User#avatar_url), so the phone keeps it and shows it without a network.
  class AvatarsController < BaseController
    def show
      avatar = Current.user.avatar or return head :not_found

      expires_in 1.year, public: false, immutable: true
      send_data avatar.data, type: "image/jpeg", disposition: :inline
    end
  end
end
