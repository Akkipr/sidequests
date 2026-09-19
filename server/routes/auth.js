const { Router } = require('express');
const { accounts } = require('../container');

const publicRoutes = Router();
publicRoutes.post('/signup', async (req, res) => res.json(await accounts.signup(req.body)));
publicRoutes.post('/login', async (req, res) => res.json(await accounts.login(req.body)));

const sessionRoutes = Router();
sessionRoutes.post('/logout', async (req, res) => {
  await accounts.logout(req.uid, req.tokenHash);
  res.json({ ok: true });
});

module.exports = { publicRoutes, sessionRoutes };
