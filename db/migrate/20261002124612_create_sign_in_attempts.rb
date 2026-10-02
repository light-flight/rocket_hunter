class CreateSignInAttempts < ActiveRecord::Migration[8.1]
  def change
    create_table :sign_in_attempts do |t|
      t.string :token, null: false, index: { unique: true }
      # NULL until a manager confirms the attempt in the bot.
      t.references :user, foreign_key: true
      t.string :user_agent

      t.timestamps
    end
  end
end
