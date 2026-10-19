// Security regression suite; no production requests or notifications.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', 'test/security.test.cjs', 'test/rendering.test.cjs', 'test/client-security.test.cjs', 'test/park-data.test.cjs', 'test/startup.test.cjs', 'test/homepage.test.cjs', 'test/local-alerts.test.cjs', 'test/good-time-alerts.test.cjs', 'test/smart-alert-ui.test.cjs', 'test/ride-alert-badge.test.cjs', 'test/park-event-hours.test.cjs'], {
  cwd: path.resolve(__dirname, '../backend'), stdio: 'inherit'
});
process.exitCode = result.status ?? 1;
