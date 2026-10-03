module Api
  # The qualification protocols of a race. The phone keeps a file it picked until it gets here,
  # under an id it made itself, so a file sent again is the same file, not a second one.
  class QualificationFilesController < BaseController
    before_action :set_race

    def index
      render json: { files: @race.qualification_files.listed.order(:created_at).map { file_json(it) }, karts: @race.karts }
    end

    # Takes a file in. One already here is answered as it is: a file never changes.
    def update
      file = @race.qualification_files.listed.find_by(id: params[:id])
      return render json: file_json(file) if file

      upload = params.expect(:file)
      return head :content_too_large if upload.size > QualificationFile::SIZE_LIMIT

      file = @race.qualification_files.new(id: params[:id], name: params[:name].presence || upload.original_filename,
        data: upload.read, created_at: added_at)
      if file.save
        render json: file_json(file), status: :created
      else
        head file.errors.include?(:content_type) ? :unsupported_media_type : :unprocessable_content
      end
    rescue ActiveRecord::RecordNotUnique
      # The same file sent twice at once: the other request took it in.
      retry
    end

    def destroy
      @race.qualification_files.where(id: params[:id]).delete_all
      head :no_content
    end

    # Reads a file again: the model was out of reach, or read it wrong.
    def read
      file = @race.qualification_files.listed.find(params[:id])
      file.read_later
      render json: file_json(file)
    end

    private
      def set_race
        @race = Race.find(params[:race_id])
      end

      # When it was picked on the phone, never ahead of the server.
      def added_at
        time = Time.zone.parse(params[:added_at].to_s)
        [ time, Time.current ].min if time
      rescue ArgumentError
        nil
      end

      def file_json(file)
        { id: file.id, name: file.name, status: file.shown_status, laps: file.laps, warnings: file.warnings,
          error: file.shown_error, added_at: file.created_at.iso8601(3) }
      end
  end
end
