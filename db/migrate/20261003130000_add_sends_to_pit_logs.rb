class AddSendsToPitLogs < ActiveRecord::Migration[8.1]
  def change
    # The last send taken from each phone, by its session, with the version it made. A phone whose
    # answer was lost sends the same log again under the same id, and learns that it was taken.
    add_column :pit_logs, :sends, :jsonb, null: false, default: {}
  end
end
