# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_10_04_120000) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "avatars", force: :cascade do |t|
    t.bigint "user_id", null: false
    t.string "telegram_file_id", null: false
    t.binary "data", null: false
    t.string "checksum", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["user_id"], name: "index_avatars_on_user_id", unique: true
  end

  create_table "invitations", force: :cascade do |t|
    t.bigint "user_id"
    t.string "token", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["token"], name: "index_invitations_on_token", unique: true
    t.index ["user_id"], name: "index_invitations_on_user_id"
  end

  create_table "pit_logs", force: :cascade do |t|
    t.uuid "race_id", null: false
    t.jsonb "moves", default: [], null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.jsonb "undone", default: [], null: false
    t.integer "lanes"
    t.bigint "lanes_at", default: 0, null: false
    t.index ["race_id"], name: "index_pit_logs_on_race_id", unique: true
    t.check_constraint "lanes >= 1 AND lanes <= 3", name: "pit_logs_lanes_range"
  end

  create_table "qualification_files", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "race_id", null: false
    t.string "name", null: false
    t.string "content_type", null: false
    t.binary "data", null: false
    t.string "checksum", null: false
    t.string "status", default: "waiting", null: false
    t.jsonb "laps", default: {}, null: false
    t.jsonb "warnings", default: [], null: false
    t.string "error"
    t.string "model"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["race_id", "checksum"], name: "index_qualification_files_on_race_id_and_checksum"
    t.index ["race_id"], name: "index_qualification_files_on_race_id"
  end

  create_table "races", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "name", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["created_at"], name: "index_races_on_created_at"
  end

  create_table "sessions", force: :cascade do |t|
    t.bigint "user_id", null: false
    t.string "ip_address"
    t.string "user_agent"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["user_id"], name: "index_sessions_on_user_id"
  end

  create_table "sign_in_attempts", force: :cascade do |t|
    t.string "token", null: false
    t.bigint "user_id"
    t.string "user_agent"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["token"], name: "index_sign_in_attempts_on_token", unique: true
    t.index ["user_id"], name: "index_sign_in_attempts_on_user_id"
  end

  create_table "users", force: :cascade do |t|
    t.bigint "telegram_id", null: false
    t.string "name", null: false
    t.string "username"
    t.bigint "invited_by_id"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["invited_by_id"], name: "index_users_on_invited_by_id"
    t.index ["telegram_id"], name: "index_users_on_telegram_id", unique: true
  end

  add_foreign_key "avatars", "users"
  add_foreign_key "invitations", "users"
  add_foreign_key "pit_logs", "races"
  add_foreign_key "qualification_files", "races"
  add_foreign_key "sessions", "users"
  add_foreign_key "sign_in_attempts", "users"
  add_foreign_key "users", "users", column: "invited_by_id"
end
