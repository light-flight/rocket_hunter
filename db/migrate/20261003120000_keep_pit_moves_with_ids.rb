class KeepPitMovesWithIds < ActiveRecord::Migration[8.1]
  # SAME_STOP_MS + 1 in frontend/src/pitlane.ts.
  OLD_STEP = 120_001

  # The pits of a race become two lists that only grow: every move, with an id and the time it was
  # entered, and the ids of the moves undone. The phones and the server put theirs together by
  # taking everything in both, so no phone writes over the moves of another.
  def up
    add_column :pit_logs, :undone, :jsonb, null: false, default: []

    # The moves that stood, each with an id made from its place and what it is, and its place for a
    # time, a little more than two minutes apart: ahead of every move entered since, and never two
    # stops of a team taken for one stop entered on two phones. A phone turns its own old log the
    # same way (fromOldLog in frontend/src/pitlane.ts), so the two give the same moves, not each
    # twice. The undone ones after count go: only the phone that undid them could do them again.
    logs(:moves, :count).each do |id, moves, count|
      moves = moves.first(count).each_with_index.map do |move, place|
        lane, kart = move.values_at("lane", "kart")
        { "id" => "L#{place}-#{lane}-#{kart || "S"}", "lane" => lane, "kart" => kart, "at" => place * OLD_STEP }
      end
      # Not through the migration, which would print every log whole.
      connection.update "UPDATE pit_logs SET moves = $1 WHERE id = $2", "SQL", [ moves.to_json, id ]
    end
    remove_column :pit_logs, :count
  end

  def down
    add_column :pit_logs, :count, :integer, null: false, default: 0

    # The moves that stand, in the order they were entered, all of them standing: nothing to redo.
    # A stop entered on two phones is kept twice.
    logs(:moves, :undone).each do |id, moves, undone|
      undone = undone.to_set
      standing = moves.reject { undone.include?(it["id"]) }.sort_by { [ it["at"], it["id"] ] }
      connection.update "UPDATE pit_logs SET moves = $1, count = $2 WHERE id = $3", "SQL",
        [ standing.map { it.slice("lane", "kart") }.to_json, standing.size, id ]
    end
    remove_column :pit_logs, :undone
  end

  private
    def logs(*columns)
      select_all("SELECT id, #{columns.join(", ")} FROM pit_logs").cast_values
    end
end
