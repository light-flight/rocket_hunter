class AddVersionToPitLogs < ActiveRecord::Migration[8.1]
  def change
    # How many times the log was written here. A phone sends the version its changes are based on,
    # so a log another phone changed since is not written over: the phone merges first.
    add_column :pit_logs, :version, :integer, null: false, default: 0
    # A log already here was written once: a phone that has never had it sends 0 and must not
    # write over it blindly.
    up_only { execute "UPDATE pit_logs SET version = 1" }
  end
end
