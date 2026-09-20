const { Router } = require('express');
const { requireAdminSecret } = require('../middleware/adminAuth');

// Admin-only, guarded by a shared secret rather than a user session. Takes its collaborators as arguments so tests
// can mount it with a fake importer.
module.exports = function adminRoutes({ importer, getSecret }) {
  const router = Router();

  // Runs the WAT2DO import now. Returns { discovered, inserted, updated, skipped, failed }.
  router.post('/admin/import-wat2do', requireAdminSecret(getSecret), async (req, res) => {
    res.json(await importer.importWat2do());
  });

  return router;
};
