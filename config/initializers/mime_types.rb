# Be sure to restart your server when you modify this file.

# The static file server takes content types from Rack, which does not know the web app
# manifest extension and would serve the React app's manifest.webmanifest as text/plain.
Rack::Mime::MIME_TYPES[".webmanifest"] = "application/manifest+json"
