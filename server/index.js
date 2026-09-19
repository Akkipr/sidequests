require('dotenv').config();
const express = require('express');
const config = require('./config');
const routes = require('./routes');
const errorHandler = require('./middleware/errors');

const app = express();
app.use(express.json());
app.use(routes({ demo: config.demoMode() }));
app.use(errorHandler);

const port = process.env.PORT ?? 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`SideQuests API on :${port}${config.demoMode() ? ' (DEMO MODE: demo routes + legacy signals enabled)' : ''}`);
});
