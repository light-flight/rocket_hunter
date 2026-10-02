ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"
require_relative "test_helpers/session_test_helper"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # Changes config.x.qualification (the reader, the API key) for the block only.
    def with_qualification(**settings)
      config = Rails.configuration.x.qualification
      old = settings.keys.index_with { config[it] }
      settings.each { |key, value| config[key] = value }
      yield
    ensure
      old.each { |key, value| config[key] = value }
    end
  end
end
