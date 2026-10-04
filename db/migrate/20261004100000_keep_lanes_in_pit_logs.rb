class KeepLanesInPitLogs < ActiveRecord::Migration[8.1]
  # The corridors of a race are chosen in its pits, the first time the pits are opened, and travel
  # with the pit log rather than with the race.
  def up
    # How many corridors the pit lane has, none until they are chosen, and when they were chosen by
    # the clock of the phone that chose: of two phones' choices the later one stands. 0 for a choice
    # made before this, which any choice made since replaces.
    add_column :pit_logs, :lanes, :integer
    add_column :pit_logs, :lanes_at, :bigint, null: false, default: 0
    add_check_constraint :pit_logs, "lanes BETWEEN 1 AND 3", name: "pit_logs_lanes_range"

    # Every race keeps the corridors it had: its pits get them, an empty log for a race without one.
    execute <<~SQL
      INSERT INTO pit_logs (race_id, created_at, updated_at)
      SELECT id, NOW(), NOW() FROM races WHERE NOT EXISTS (SELECT 1 FROM pit_logs WHERE race_id = races.id)
    SQL
    execute "UPDATE pit_logs SET lanes = races.lanes FROM races WHERE races.id = pit_logs.race_id"

    remove_check_constraint :races, "lanes BETWEEN 1 AND 3", name: "races_lanes_range"
    remove_column :races, :lanes, :integer, null: false, default: 1
  end

  # Each race gets back the corridors of its pits, one where none were chosen. The empty logs stay:
  # a race with an empty log has the same pits as one without.
  def down
    add_column :races, :lanes, :integer, null: false, default: 1
    add_check_constraint :races, "lanes BETWEEN 1 AND 3", name: "races_lanes_range"
    execute <<~SQL
      UPDATE races SET lanes = pit_logs.lanes FROM pit_logs
      WHERE pit_logs.race_id = races.id AND pit_logs.lanes IS NOT NULL
    SQL

    remove_check_constraint :pit_logs, "lanes BETWEEN 1 AND 3", name: "pit_logs_lanes_range"
    remove_column :pit_logs, :lanes_at
    remove_column :pit_logs, :lanes
  end
end
