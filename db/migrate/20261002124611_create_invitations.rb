class CreateInvitations < ActiveRecord::Migration[8.1]
  def change
    create_table :invitations do |t|
      # The inviter; NULL for an invitation made in the console.
      t.references :user, foreign_key: true
      t.string :token, null: false, index: { unique: true }

      t.timestamps
    end
  end
end
