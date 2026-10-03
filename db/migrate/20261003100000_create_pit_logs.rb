class CreatePitLogs < ActiveRecord::Migration[8.1]
  def change
    # Everything done in the pits of a race, as the phone that enters it keeps it: the moves in
    # order and how many of them stand (the rest were undone). One per race.
    create_table :pit_logs do |t|
      t.references :race, type: :uuid, null: false, foreign_key: true, index: { unique: true }
      t.jsonb :moves, null: false, default: []
      t.integer :count, null: false, default: 0

      t.timestamps
    end
  end
end
