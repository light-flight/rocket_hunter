class CreateRaces < ActiveRecord::Migration[8.1]
  def change
    # The phone that makes a race picks its id, so a race made without a network can be sent
    # as many times as it takes and still exists once.
    create_table :races, id: :uuid do |t|
      t.string :name, null: false

      t.timestamps
    end
    add_index :races, :created_at
  end
end
