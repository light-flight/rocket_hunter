module Api
  class InvitationsController < BaseController
    rate_limit to: 10, within: 3.minutes, with: -> { head :too_many_requests }

    def create
      invitation = Current.user.invitations.create!
      render json: { url: invitation.url }, status: :created
    end
  end
end
