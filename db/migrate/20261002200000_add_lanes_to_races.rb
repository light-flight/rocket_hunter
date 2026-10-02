class AddLanesToRaces < ActiveRecord::Migration[8.1]
  def change
    # How many corridors the pit lane has. Karts wait in each of them to be taken out again.
    add_column :races, :lanes, :integer, null: false, default: 1
    add_check_constraint :races, "lanes BETWEEN 1 AND 3", name: "races_lanes_range"
  end
end
