class CreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      # Telegram user ids need 52 bits.
      t.bigint :telegram_id, null: false, index: { unique: true }
      t.string :name, null: false
      t.string :username
      # The only trace of who let whom in; NULL for the first manager.
      t.references :invited_by, foreign_key: { to_table: :users }

      t.timestamps
    end
  end
end
