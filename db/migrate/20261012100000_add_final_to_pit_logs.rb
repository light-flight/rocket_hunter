class AddFinalToPitLogs < ActiveRecord::Migration[8.1]
  # The final going on in the pits of a race: what it is like (pilots, minutes, when the pit lane
  # closes, the stops each must make, the lights in the corridors) and when it started, none before a
  # phone sets one up. final_at is when it was last changed, by the clock of the phone that changed it:
  # of two phones' changes the later one stands.
  def change
    add_column :pit_logs, :final, :jsonb
    add_column :pit_logs, :final_at, :bigint, null: false, default: 0
  end
end
