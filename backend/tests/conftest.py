import os

# Long enough to pass the minimum length check in app.auth. Test use only.
os.environ["AUTH_JWT_SECRET"] = "test-only-secret-that-is-at-least-32-characters-long"
