-- Runs once when the test database container is created. Marks the database
-- as a test database; the test suite refuses to run against any database
-- without this marker, so it can never touch development or production data.
ALTER DATABASE orbyn_test SET orbyn.environment TO 'test';
