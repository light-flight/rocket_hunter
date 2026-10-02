class CreateQualificationFiles < ActiveRecord::Migration[8.1]
  def change
    # A qualification protocol of a race: a PDF, a photo or a screenshot. The phone picks the
    # id, as for races. The bytes stay in the database, so its backups keep the originals too.
    create_table :qualification_files, id: :uuid do |t|
      t.references :race, type: :uuid, null: false, foreign_key: true
      t.string :name, null: false
      t.string :content_type, null: false
      t.binary :data, null: false
      t.string :checksum, null: false
      t.string :status, null: false, default: "waiting"
      # What the model read, made into numbers: {"<kart>": [<best lap, ms>, ...]}.
      t.jsonb :laps, null: false, default: {}
      t.jsonb :warnings, null: false, default: []
      t.string :error
      t.string :model

      t.timestamps
    end
    add_index :qualification_files, %i[ race_id checksum ]
  end
end
