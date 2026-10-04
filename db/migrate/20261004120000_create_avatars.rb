class CreateAvatars < ActiveRecord::Migration[8.1]
  def change
    # A manager's Telegram profile photo, copied here: a file link from Telegram carries the bot
    # token, so the phones get the bytes from the app. Its own table, so loading a user for every
    # request does not load the picture.
    create_table :avatars do |t|
      t.references :user, null: false, foreign_key: true, index: { unique: true }
      # Telegram's file_unique_id: the same photo is not downloaded again.
      t.string :telegram_file_id, null: false
      t.binary :data, null: false
      # Names the picture in its address, so a phone may keep it for good.
      t.string :checksum, null: false

      t.timestamps
    end
  end
end
